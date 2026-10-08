import { cached, getJson } from "./http";
import { FIATS, type Rates } from "./outside";
import { coingeckoPrices } from "./prices";

const SYMBOLS = FIATS.filter((c) => c !== "USD");

/** Units of each currency per US dollar, from the ECB reference rates (no key), with a fallback. */
async function fiatPerUsd(): Promise<Partial<Record<string, number>>> {
  try {
    const data = await getJson<{ rates: Record<string, number> }>(`https://api.frankfurter.dev/v1/latest?base=USD&symbols=${SYMBOLS.join(",")}`);
    return data.rates;
  } catch {
    const data = await getJson<{ result: string; rates: Record<string, number> }>("https://open.er-api.com/v6/latest/USD");
    if (data.result !== "success") throw new Error("Exchange rates unavailable");
    return data.rates;
  }
}

export interface FxSnapshot {
  /** USD per unit for every unit the outside-holdings form offers. */
  rates: Rates;
  asOf: string;
}

/** Fiat and coin rates in one shape, so a stated amount can be fixed in dollars anywhere. */
export function getFx(): Promise<FxSnapshot> {
  return cached("fx", 60 * 60_000, async () => {
    const [fiat, coins] = await Promise.all([fiatPerUsd(), coingeckoPrices(["bitcoin", "ethereum"]).catch(() => ({}) as Record<string, number>)]);
    const rates: Rates = { USD: 1 };
    for (const c of SYMBOLS) {
      const perUsd = fiat[c];
      if (perUsd && perUsd > 0) rates[c] = 1 / perUsd;
    }
    if (coins.bitcoin) rates.BTC = coins.bitcoin;
    if (coins.ethereum) rates.ETH = coins.ethereum;
    return { rates, asOf: new Date().toISOString() };
  });
}
