import { cached, getJson } from "./http";
import { getMarketSnapshot } from "./market";
import { SIGNALS, type FiredEvent, type SignalId, type SignalReading, type SignalsResponse, type SignalStatus } from "./signals";
import type { MarketSnapshot } from "./types";

const TTL_MS = 10 * 60_000;
const FIRED_SHOWN = 8;

const FNG_LINE = 85;
/** Fear & Greed hovers around its line for weeks; it only fires again after falling back this far. */
const FNG_REARM = 75;
const DOMINANCE_LINE = 50;
const SMA_WEEKS = 200;
const SIGMA_LINE = 2;
const FUNDING_LINE_APR = 30;
/** "Close" is within a tenth of the threshold. */
const NEAR = 0.1;

interface Feed {
  now: string;
  status: SignalStatus;
  firedAt?: string;
  /** ISO dates of every firing on record, oldest first. */
  history?: string[];
}

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const withSign = (n: number, digits: number) => `${n < 0 ? "−" : "+"}${Math.abs(n).toFixed(digits)}`;

function above(value: number, line: number, inclusive = false): SignalStatus {
  if (inclusive ? value >= line : value > line) return "fired";
  return value >= line - Math.abs(line) * NEAR ? "close" : "quiet";
}

async function fearGreed(snapshot: MarketSnapshot | null): Promise<Feed> {
  const res = await getJson<{ data: { value: string; timestamp: string }[] }>("https://api.alternative.me/fng/?limit=0");
  const series = res.data
    .map((d) => ({ value: Number(d.value), at: Number(d.timestamp) * 1000 }))
    .filter((p) => Number.isFinite(p.value) && Number.isFinite(p.at))
    .sort((a, b) => a.at - b.at);
  const history: string[] = [];
  let armed = true;
  for (const p of series) {
    if (p.value > FNG_LINE) {
      if (armed) history.push(isoDay(p.at));
      armed = false;
    } else if (p.value <= FNG_REARM) armed = true;
  }
  const now = snapshot?.fearGreed?.value ?? series.at(-1)?.value;
  if (now == null) throw new Error("No Fear & Greed reading.");
  const status = above(now, FNG_LINE);
  return { now: String(now), status, firedAt: status === "fired" ? history.at(-1) : undefined, history };
}

function dominance(snapshot: MarketSnapshot | null): Feed {
  const now = snapshot?.btcDominance;
  if (now == null) throw new Error("No dominance reading.");
  const status: SignalStatus = now < DOMINANCE_LINE ? "fired" : now <= DOMINANCE_LINE * (1 + NEAR) ? "close" : "quiet";
  return { now: `${now.toFixed(1)}%`, status };
}

/**
 * How stretched BTC is above its 200-week average: the z-score of ln(close / 200-week SMA),
 * measured against every week Kraken has on record (2013 onward).
 */
async function twoHundredWeek(): Promise<Feed> {
  const res = await getJson<{ error: string[]; result: Record<string, unknown> }>("https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=10080");
  if (res.error?.length) throw new Error(res.error.join(", "));
  const candles = Object.entries(res.result).find(([key]) => key !== "last")?.[1] as [number, string, string, string, string][] | undefined;
  if (!candles || candles.length < SMA_WEEKS + 52) throw new Error("Not enough weekly history.");

  const stretch: { at: number; x: number }[] = [];
  let sum = 0;
  candles.forEach((c, i) => {
    const close = Number(c[4]);
    sum += close;
    if (i >= SMA_WEEKS) sum -= Number(candles[i - SMA_WEEKS][4]);
    if (i >= SMA_WEEKS - 1) stretch.push({ at: c[0] * 1000, x: Math.log(close / (sum / SMA_WEEKS)) });
  });
  const mean = stretch.reduce((s, p) => s + p.x, 0) / stretch.length;
  const sd = Math.sqrt(stretch.reduce((s, p) => s + (p.x - mean) ** 2, 0) / stretch.length);
  const z = stretch.map((p) => ({ at: p.at, z: (p.x - mean) / sd }));

  const history: string[] = [];
  for (let i = 1; i < z.length; i++) if (z[i].z >= SIGMA_LINE && z[i - 1].z < SIGMA_LINE) history.push(isoDay(z[i].at));
  const now = z.at(-1)!.z;
  if (!Number.isFinite(now)) throw new Error("No 200-week reading.");
  const status = above(now, SIGMA_LINE, true);
  return { now: `${withSign(now, 1)}σ`, status, firedAt: status === "fired" ? history.at(-1) : undefined, history };
}

/** BTC perp funding on Hyperliquid, averaged over the last seven days and annualised. */
async function funding(): Promise<Feed> {
  const rows = await getJson<{ fundingRate: string }[]>("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "fundingHistory", coin: "BTC", startTime: Date.now() - 7 * 86_400_000 }),
  });
  const rates = rows.map((r) => Number(r.fundingRate)).filter(Number.isFinite);
  // Funding settles hourly; anything much short of a week is not "for a week".
  if (rates.length < 24 * 6) throw new Error("Not enough funding history.");
  const apr = (rates.reduce((s, r) => s + r, 0) / rates.length) * 24 * 365 * 100;
  return { now: `${apr < 0 ? "−" : ""}${Math.abs(apr).toFixed(0)}%`, status: above(apr, FUNDING_LINE_APR) };
}

export function getSignals(): Promise<SignalsResponse> {
  return cached("signals", TTL_MS, async () => {
    const snapshot = await getMarketSnapshot().catch(() => null);
    // Berkshire cash, CAPE and MVRV have no agreed source yet, so they have no feed.
    const feeds: Partial<Record<SignalId, () => Promise<Feed> | Feed>> = {
      fng: () => fearGreed(snapshot),
      dom: () => dominance(snapshot),
      w200: twoHundredWeek,
      fund: funding,
    };

    // One feed being down must not take the others with it.
    const settled = await Promise.all(
      SIGNALS.map(async (s) => {
        try {
          return (await feeds[s.id]?.()) ?? null;
        } catch {
          return null;
        }
      }),
    );

    const readings: SignalReading[] = SIGNALS.map((s, i) => {
      const feed = settled[i];
      return feed ? { id: s.id, now: feed.now, status: feed.status, firedAt: feed.firedAt } : { id: s.id, now: null, status: "unavailable" };
    });
    const fired: FiredEvent[] = SIGNALS.flatMap((s, i) => (settled[i]?.history ?? []).map((date) => ({ id: s.id, name: s.name, date })))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, FIRED_SHOWN);

    return { asOf: new Date().toISOString(), readings, fired };
  });
}
