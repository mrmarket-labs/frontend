import { cached, getJson } from "./http";

const COINGECKO = process.env.COINGECKO_API_KEY
  ? { base: "https://pro-api.coingecko.com/api/v3", headers: { "x-cg-pro-api-key": process.env.COINGECKO_API_KEY } }
  : { base: "https://api.coingecko.com/api/v3", headers: {} as Record<string, string> };

export function coingecko<T>(path: string): Promise<T> {
  return getJson<T>(`${COINGECKO.base}${path}`, { headers: COINGECKO.headers });
}

/** USD prices keyed by CoinGecko id. */
export async function coingeckoPrices(ids: string[]): Promise<Record<string, number>> {
  const unique = [...new Set(ids)].sort();
  if (unique.length === 0) return {};
  return cached(`cg-prices:${unique.join(",")}`, 60_000, async () => {
    const data = await coingecko<Record<string, { usd?: number }>>(
      `/simple/price?ids=${unique.join(",")}&vs_currencies=usd`,
    );
    return Object.fromEntries(
      Object.entries(data).flatMap(([id, v]) => (v.usd != null ? [[id, v.usd]] : [])),
    );
  });
}
