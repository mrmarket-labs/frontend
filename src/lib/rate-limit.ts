const hits = new Map<string, number[]>();

/**
 * Best-effort sliding-window limit per client IP. State is per server instance,
 * so it slows down casual abuse of the paid advisor endpoint rather than strictly enforcing a quota.
 */
export function rateLimit(request: Request, limit: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    return { ok: false, retryAfterSec: Math.ceil((recent[0] + windowMs - now) / 1000) };
  }
  recent.push(now);
  hits.set(ip, recent);
  return { ok: true, retryAfterSec: 0 };
}
