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
  // The advisor may split one asset across venues (native BTC + cbBTC). Sum the target and
  // route the buy to the venue the app can execute on, or failing that the largest slice.
  const EXECUTABLE = new Set(["solana", "ethereum", "ethereum-l2"]);
  const targets = new Map<string, Advice["allocations"][number]>();
  for (const a of advice.allocations) {
    const key = a.asset.toUpperCase();
    const prev = targets.get(key);
    if (!prev) {
      targets.set(key, { ...a });
      continue;
    }
    const preferNew = EXECUTABLE.has(a.venue) && (!EXECUTABLE.has(prev.venue) || a.targetPct > prev.targetPct);
    targets.set(key, { ...(preferNew ? a : prev), targetPct: prev.targetPct + a.targetPct });
  }

  const trades: Trade[] = [];
  for (const key of new Set([...current.keys(), ...targets.keys()])) {
    const cur = current.get(key);
    const target = targets.get(key);
    const currentPct = ((cur?.usd ?? 0) / total) * 100;
    const targetPct = target?.targetPct ?? 0;
    const diffPct = targetPct - currentPct;
    if (Math.abs(diffPct) < MIN_TRADE_PCT) continue;
    trades.push({
      action: diffPct > 0 ? "buy" : "sell",
      asset: target?.asset ?? key,
      usd: Math.abs((diffPct / 100) * total),
      currentPct,
      targetPct,
      heldAs: cur ? [...cur.heldAs] : [],
      venue: target?.venue,
      instrument: target?.instrument,
    });
  }
  // Sells first: they fund the buys.
  return trades.sort((a, b) => (a.action === b.action ? b.usd - a.usd : a.action === "sell" ? -1 : 1));
}
