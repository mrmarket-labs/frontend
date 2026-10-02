import { cached, getJson } from "./http";
import { coingecko } from "./prices";
import type { AssetTrend, MarketSnapshot, Regime } from "./types";

const TRACKED = [
  { id: "bitcoin", symbol: "BTC" },
  { id: "ethereum", symbol: "ETH" },
  { id: "solana", symbol: "SOL" },
];

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const pct = (a: number, b: number) => (a / b - 1) * 100;

function trend(symbol: string, prices: number[]): AssetTrend {
  const price = prices.at(-1)!;
  const at = (daysAgo: number) => prices[Math.max(0, prices.length - 1 - daysAgo)];
  const returns = prices.slice(-31).slice(1).map((p, i) => Math.log(p / prices.slice(-31)[i]));
  const avg = mean(returns);
  const stdev = Math.sqrt(mean(returns.map((r) => (r - avg) ** 2)));
  return {
    symbol,
    price,
    change30d: pct(price, at(30)),
    change90d: pct(price, at(90)),
    vsSma50: pct(price, mean(prices.slice(-50))),
    vsSma200: pct(price, mean(prices.slice(-200))),
    volatility30d: stdev * Math.sqrt(365) * 100,
    drawdownFromHigh: pct(price, Math.max(...prices)),
  };
}

/**
 * Simple, explainable regime score in [-100, 100]: trend (price vs 50/200-day averages)
 * plus a contrarian read of the Fear & Greed index. Claude gets the raw inputs too.
 */
function scoreRegime(assets: AssetTrend[], fearGreed: number | null): { score: number; regime: Regime; notes: string[] } {
  const notes: string[] = [];
  let score = 0;
  for (const a of assets) {
    const above200 = a.vsSma200 > 0;
    const above50 = a.vsSma50 > 0;
    score += (above200 ? 15 : -15) + (above50 ? 8 : -8);
    notes.push(
      `${a.symbol} is ${above200 ? "above" : "below"} its 200-day average (${a.vsSma200.toFixed(1)}%) and ` +
      `${a.drawdownFromHigh.toFixed(0)}% from its 200-day high.`,
    );
  }
  if (fearGreed != null) {
    if (fearGreed >= 75) { score -= 15; notes.push(`Fear & Greed at ${fearGreed}: extreme greed, so be cautious about adding risk.`); }
    else if (fearGreed <= 25) { score += 10; notes.push(`Fear & Greed at ${fearGreed}: extreme fear, often a better time to accumulate.`); }
  }
  score = Math.max(-100, Math.min(100, score));
  const regime: Regime = score >= 30 ? "risk-on" : score <= -30 ? "risk-off" : "neutral";
  return { score, regime, notes };
}

export function getMarketSnapshot(): Promise<MarketSnapshot> {
  return cached("market", 10 * 60_000, async () => {
    const [charts, global, fng] = await Promise.all([
      Promise.all(
        TRACKED.map(({ id }) =>
          coingecko<{ prices: [number, number][] }>(`/coins/${id}/market_chart?vs_currency=usd&days=200&interval=daily`),
        ),
      ),
      coingecko<{ data: { total_market_cap: { usd: number }; market_cap_percentage: { btc: number }; market_cap_change_percentage_24h_usd: number } }>(
        "/global",
      ).catch(() => null),
      getJson<{ data: { value: string; value_classification: string }[] }>("https://api.alternative.me/fng/?limit=1").catch(() => null),
    ]);

    const assets = charts.map((c, i) => trend(TRACKED[i].symbol, c.prices.map(([, p]) => p)));
    const fearGreed = fng?.data[0]
      ? { value: Number(fng.data[0].value), label: fng.data[0].value_classification }
      : null;
    const { score, regime, notes } = scoreRegime(assets, fearGreed?.value ?? null);

    return {
      asOf: new Date().toISOString(),
      regime,
      regimeScore: score,
      fearGreed,
      btcDominance: global?.data.market_cap_percentage.btc ?? null,
      totalMarketCapUsd: global?.data.total_market_cap.usd ?? null,
      marketCapChange24h: global?.data.market_cap_change_percentage_24h_usd ?? null,
      assets,
      notes,
    };
  });
}
