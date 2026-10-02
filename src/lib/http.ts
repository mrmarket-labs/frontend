const cache = new Map<string, { expires: number; value: unknown }>();

/** In-memory TTL cache so free public APIs (CoinGecko especially) don't rate-limit us. */
export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  const value = await fn();
  cache.set(key, { expires: Date.now() + ttlMs, value });
  return value;
}

export async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(15_000),
    headers: { accept: "application/json", ...init?.headers },
  });
  if (!res.ok) throw new Error(`${new URL(url).host} responded ${res.status}`);
  return res.json() as Promise<T>;
}

export async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const body = await getJson<{ result?: T; error?: { message: string } }>(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (body.error) throw new Error(body.error.message);
  return body.result as T;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
