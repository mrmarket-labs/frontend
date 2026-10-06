/**
 * Durable counters and a small cache on Upstash Redis (REST), shared by every serverless
 * instance. Without Redis credentials it falls back to in-memory state, which is fine for
 * local development but offers no real protection in production.
 */
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "";
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "";

export const hasDurableStore = Boolean(REDIS_URL && REDIS_TOKEN);
let warned = false;

const memory = new Map<string, { value: string; expires: number }>();

async function redis<T>(...command: (string | number)[]): Promise<T> {
  const res = await fetch(REDIS_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${REDIS_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(5000),
  });
  const data = (await res.json()) as { result?: T; error?: string };
  if (!res.ok || data.error) throw new Error(data.error ?? `Redis responded ${res.status}`);
  return data.result as T;
}

function memGet(key: string): string | null {
  const hit = memory.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    memory.delete(key);
    return null;
  }
  return hit.value;
}

export interface LimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
}

/** Fixed-window counter: at most `limit` hits per `windowSec` for this key. */
export async function hit(key: string, limit: number, windowSec: number): Promise<LimitResult> {
  if (!hasDurableStore) {
    if (!warned && process.env.NODE_ENV === "production") {
      warned = true;
      console.warn("[limits] No Redis configured: rate limits are per-instance only.");
    }
    const current = Number(memGet(key) ?? 0) + 1;
    const existing = memory.get(key);
    const expires = existing && existing.expires > Date.now() ? existing.expires : Date.now() + windowSec * 1000;
    memory.set(key, { value: String(current), expires });
    return { ok: current <= limit, remaining: Math.max(0, limit - current), retryAfterSec: Math.ceil((expires - Date.now()) / 1000) };
  }
  const count = await redis<number>("INCR", key);
  if (count === 1) await redis("EXPIRE", key, windowSec);
  const ttl = count > limit ? await redis<number>("TTL", key) : windowSec;
  return { ok: count <= limit, remaining: Math.max(0, limit - count), retryAfterSec: Math.max(1, ttl) };
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const raw = hasDurableStore ? await redis<string | null>("GET", key) : memGet(key);
  return raw ? (JSON.parse(raw) as T) : null;
}

export async function cacheSet(key: string, value: unknown, ttlSec: number): Promise<void> {
  const raw = JSON.stringify(value);
  if (hasDurableStore) await redis("SET", key, raw, "EX", ttlSec);
  else memory.set(key, { value: raw, expires: Date.now() + ttlSec * 1000 });
}

/** Set only if absent. Returns false when the key already existed (used for single-use tokens). */
export async function setIfAbsent(key: string, ttlSec: number): Promise<boolean> {
  if (hasDurableStore) return (await redis<string | null>("SET", key, "1", "NX", "EX", ttlSec)) === "OK";
  if (memGet(key) != null) return false;
  memory.set(key, { value: "1", expires: Date.now() + ttlSec * 1000 });
  return true;
}

export async function cacheDelete(key: string): Promise<void> {
  if (hasDurableStore) await redis("DEL", key);
  else memory.delete(key);
}

export function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0].trim() || request.headers.get("x-real-ip") || "unknown";
}

/** YYYY-MM-DD in UTC, for daily windows. */
export const today = () => new Date().toISOString().slice(0, 10);

export function tooMany(message: string, retryAfterSec: number): Response {
  return Response.json({ error: message }, { status: 429, headers: { "retry-after": String(retryAfterSec) } });
}
