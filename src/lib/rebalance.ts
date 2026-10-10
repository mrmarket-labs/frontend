import type { Advice } from "./advisor";
import type { Venue } from "./options";
import type { Holding } from "./types";

export interface Trade {
  action: "buy" | "sell";
  asset: string;
  usd: number;
  currentPct: number;
  targetPct: number;
  /** Where the user currently holds the asset, e.g. "JitoSOL on solana". */
  heldAs: string[];
  /** For buys: where and what to buy. */
  venue?: Venue;
  instrument?: string;
}

/** Skip trades smaller than this share of the portfolio: the fees aren't worth it. */
const MIN_TRADE_PCT = 1;

export function computeTrades(holdings: Holding[], advice: Advice): Trade[] {
  const total = holdings.reduce((s, h) => s + h.valueUsd, 0);
  if (total === 0) return [];

  const current = new Map<string, { usd: number; heldAs: Set<string> }>();
  for (const h of holdings) {
    const key = h.asset.toUpperCase();
    const entry = current.get(key) ?? { usd: 0, heldAs: new Set<string>() };
    entry.usd += h.valueUsd;
    entry.heldAs.add(`${h.symbol} on ${h.chain}`);
    current.set(key, entry);
  }
  // The advisor may split one asset across venues (cbBTC on Ethereum + UBTC on Hyperliquid).
  // The gap is judged on the asset's summed target; a buy then lands on each venue in proportion.
  type Slice = Advice["allocations"][number];
  const targets = new Map<string, { asset: string; targetPct: number; slices: Slice[] }>();
  for (const a of advice.allocations) {
    const key = a.asset.toUpperCase();
    const entry = targets.get(key) ?? { asset: a.asset, targetPct: 0, slices: [] };
    entry.targetPct += a.targetPct;
    entry.slices.push(a);
    targets.set(key, entry);
  }

  const trades: Trade[] = [];
  for (const key of new Set([...current.keys(), ...targets.keys()])) {
    const cur = current.get(key);
    const target = targets.get(key);
    const currentPct = ((cur?.usd ?? 0) / total) * 100;
    const targetPct = target?.targetPct ?? 0;
    const diffPct = targetPct - currentPct;
    if (Math.abs(diffPct) < MIN_TRADE_PCT) continue;
    const usd = Math.abs((diffPct / 100) * total);
    const slices = [...(target?.slices ?? [])].sort((a, b) => b.targetPct - a.targetPct);
    const base = { asset: target?.asset ?? key, currentPct, targetPct, heldAs: cur ? [...cur.heldAs] : [] };
    if (diffPct < 0 || !target) {
      trades.push({ ...base, action: "sell", usd, venue: slices[0]?.venue, instrument: slices[0]?.instrument });
      continue;
    }
    // Slices too small to be worth a trade fold into the largest one.
    const parts = slices.map((s) => (usd * s.targetPct) / target.targetPct);
    const small = parts.reduce((sum, p, i) => (i > 0 && (p / total) * 100 < MIN_TRADE_PCT ? sum + p : sum), 0);
    slices.forEach((s, i) => {
      const part = i === 0 ? parts[0] + small : (parts[i] / total) * 100 < MIN_TRADE_PCT ? 0 : parts[i];
      if (part > 0) trades.push({ ...base, action: "buy", usd: part, venue: s.venue, instrument: s.instrument });
    });
  }
  // Sells first: they fund the buys.
  return trades.sort((a, b) => (a.action === b.action ? b.usd - a.usd : a.action === "sell" ? -1 : 1));
}
