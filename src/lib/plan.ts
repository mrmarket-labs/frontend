import type { Dict } from "./i18n";
import type { Venue } from "./options";
import type { Trade } from "./rebalance";
import { GAS_RESERVE, L2_CHAINS, NATIVE, WSOL_MINT, isExecChain, resolveToken, type ExecChain, type TokenInfo } from "./tokens";
import type { Holding } from "./types";

/** Steps below this are not worth the network fee. */
const MIN_STEP_USD = 5;
/** A stablecoin shortfall below this (or below 1% of the portfolio) isn't worth another transfer. */
const MIN_BRIDGE_USD = 25;
const STABLES = ["USDC", "USDT"];
const isStable = (symbol: string) => STABLES.includes(symbol.toUpperCase());

export interface SwapStep {
  id: string;
  kind: "swap";
  address: string;
  chain: ExecChain;
  sell: { symbol: string; token: TokenInfo; amount: number; usd: number };
  buy: { symbol: string; token: TokenInfo; usd: number };
  /** Part of the proceeds is parked in a stablecoin because what it funds lives on another chain. */
  parkedUsd: number;
}

export interface ManualStep {
  id: string;
  kind: "manual";
  address?: string;
  where: string;
  title: string;
  detail: string;
  usd: number;
  /** The canonical asset this step sells or buys, so the advisor's reasons can be shown beside it. */
  move?: { action: "sell" | "buy"; asset: string };
}

export type Step = SwapStep | ManualStep;

interface SellLeg {
  holding: Holding;
  chain: ExecChain;
  token: TokenInfo;
  usd: number;
}
interface BuyLeg {
  asset: string;
  instrument: string;
  token: TokenInfo;
  usd: number;
}

const usd0 = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

function isNative(chain: ExecChain, token: TokenInfo): boolean {
  return chain === "solana" ? token.address === WSOL_MINT : token.address === NATIVE;
}

/** How much of a holding can actually be sold, leaving gas behind on native coins. */
function sellableAmount(h: Holding, chain: ExecChain, token: TokenInfo, usd: number): number {
  const wanted = usd / h.priceUsd;
  const max = h.amount - (isNative(chain, token) ? GAS_RESERVE[chain] : 0);
  return Math.min(wanted, Math.max(0, max));
}

function swapStep(leg: SellLeg, buy: { symbol: string; token: TokenInfo }, usd: number, parks = false): SwapStep | null {
  const amount = sellableAmount(leg.holding, leg.chain, leg.token, usd);
  const realUsd = amount * leg.holding.priceUsd;
  if (realUsd < MIN_STEP_USD) return null;
  return {
    id: `swap:${leg.holding.address}:${leg.chain}:${leg.token.symbol}>${buy.token.symbol}`,
    kind: "swap",
    address: leg.holding.address,
    chain: leg.chain,
    sell: { symbol: leg.holding.symbol, token: leg.token, amount, usd: realUsd },
    buy: { symbol: buy.symbol, token: buy.token, usd: realUsd },
    parkedUsd: parks ? realUsd : 0,
  };
}

/** Same wallet, chain and pair: one signature instead of two. */
function mergeSwaps(steps: Step[]): Step[] {
  const byId = new Map<string, SwapStep>();
  const out: Step[] = [];
  for (const s of steps) {
    if (s.kind !== "swap") {
      out.push(s);
      continue;
    }
    const prev = byId.get(s.id);
    if (!prev) {
      byId.set(s.id, s);
      out.push(s);
      continue;
    }
    prev.sell = { ...prev.sell, amount: prev.sell.amount + s.sell.amount, usd: prev.sell.usd + s.sell.usd };
    prev.buy = { ...prev.buy, usd: prev.buy.usd + s.buy.usd };
    prev.parkedUsd += s.parkedUsd;
  }
  return out;
}

/**
 * Turn the advisor's asset-level trades into concrete steps: direct same-chain swaps where sells
 * and buys share a chain, stablecoin parking where they don't, and manual instructions for venues
 * the app can't execute yet (Bitcoin, Hyperliquid, bridges).
 *
 * Step ids carry no text, so the same inputs compile to the same ids in every language and
 * progress survives a language switch.
 */
export function compilePlan(holdings: Holding[], trades: Trade[], t: Dict): Step[] {
  const { steps: s, chains: CHAIN_LABELS, venues: VENUE_LABELS } = t;
  const steps: Step[] = [];
  const minBridge = Math.max(MIN_BRIDGE_USD, holdings.reduce((s, h) => s + h.valueUsd, 0) * 0.01);
  const sells = new Map<ExecChain, SellLeg[]>();
  const buys = new Map<ExecChain, BuyLeg[]>();
  const push = <T,>(m: Map<ExecChain, T[]>, k: ExecChain, v: T) => m.set(k, [...(m.get(k) ?? []), v]);

  // 1. Sells: spread each asset sale across the wallets/chains that hold it.
  for (const t of trades.filter((t) => t.action === "sell")) {
    const held = holdings.filter((h) => h.asset.toUpperCase() === t.asset.toUpperCase());
    const total = held.reduce((s, h) => s + h.valueUsd, 0) || 1;
    for (const h of held) {
      const usd = (t.usd * h.valueUsd) / total;
      if (usd < MIN_STEP_USD) continue;
      const token = isExecChain(h.chain) && h.tokenAddress && h.decimals != null
        ? { symbol: h.symbol, address: h.tokenAddress, decimals: h.decimals }
        : null;
      if (token && isExecChain(h.chain)) push(sells, h.chain, { holding: h, chain: h.chain, token, usd });
      else
        steps.push({
          id: `manual:sell:${h.address}:${h.chain}:${h.symbol}`,
          kind: "manual",
          address: h.address,
          where: CHAIN_LABELS[h.chain],
          title: s.sellTitle(usd0(usd), h.symbol, CHAIN_LABELS[h.chain]),
          detail: h.chain === "bitcoin" ? s.sellBitcoin : isExecChain(h.chain) ? s.sellRescan : s.sellHyperliquid,
          usd,
          move: { action: "sell", asset: h.asset },
        });
    }
  }

  // 2. Buys: pin each to the chain its venue implies. L2 buys go where the most proceeds are.
  const sellUsdOn = (c: ExecChain) => (sells.get(c) ?? []).reduce((s, l) => s + l.usd, 0);
  const buyTrades = trades.filter((t) => t.action === "buy");
  for (const t of buyTrades.filter((t) => !isStable(t.asset))) {
    const venue = t.venue as Venue | undefined;
    const instrument = t.instrument ?? t.asset;
    let chain: ExecChain | null = null;
    if (venue === "solana") chain = "solana";
    else if (venue === "ethereum") chain = "ethereum";
    else if (venue === "ethereum-l2") chain = [...L2_CHAINS].sort((a, b) => sellUsdOn(b) - sellUsdOn(a))[0];
    const token = chain ? (resolveToken(chain, instrument) ?? resolveToken(chain, t.asset)) : null;

    if (chain && token) push(buys, chain, { asset: t.asset, instrument: token.symbol, token, usd: t.usd });
    else
      steps.push({
        id: `manual:buy:${venue ?? "unknown"}:${t.asset}`,
        kind: "manual",
        where: venue ? VENUE_LABELS[venue] : s.unknownVenue,
        title: s.buyTitle(usd0(t.usd), instrument, venue ? VENUE_LABELS[venue] : null),
        detail:
          venue === "hyperliquid-perp"
            ? s.buyPerp(instrument)
            : venue === "hyperliquid-spot"
              ? s.buySpot(instrument)
              : venue === "bitcoin"
                ? s.buyBitcoin
                : s.buyUnlisted(instrument),
        usd: t.usd,
        move: { action: "buy", asset: t.asset },
      });
  }

  // Stablecoins are the same asset on every chain, so buy them wherever proceeds are left over
  // instead of bridging. Whatever no chain can cover has to come from outside.
  const buyUsdOn = (c: ExecChain) => (buys.get(c) ?? []).reduce((s, l) => s + l.usd, 0);
  for (const t of buyTrades.filter((t) => isStable(t.asset))) {
    let remaining = t.usd;
    const capacity = [...sells.keys()]
      .map((c) => ({ chain: c, cap: sellUsdOn(c) - buyUsdOn(c) }))
      .filter((x) => x.cap >= MIN_STEP_USD)
      .sort((a, b) => b.cap - a.cap);
    for (const { chain, cap } of capacity) {
      const take = Math.min(remaining, cap);
      if (take < MIN_STEP_USD) continue;
      const token = resolveToken(chain, t.instrument ?? t.asset) ?? resolveToken(chain, "USDC");
      if (!token) continue;
      push(buys, chain, { asset: t.asset, instrument: token.symbol, token, usd: take });
      remaining -= take;
      if (remaining < MIN_STEP_USD) break;
    }
    if (remaining >= minBridge)
      steps.push({
        id: `manual:fund:stable:${t.asset}`,
        kind: "manual",
        where: s.anyChain,
        title: s.addStableTitle(usd0(remaining), t.asset),
        detail: s.addStableDetail(usd0(remaining), t.asset),
        usd: remaining,
        move: { action: "buy", asset: t.asset },
      });
  }

  // 3. Per chain, pair the largest sells with the largest buys into direct swaps.
  const surplus = new Map<ExecChain, number>();
  const deficits: { chain: ExecChain; buy: BuyLeg; usd: number }[] = [];
  const chains = new Set<ExecChain>([...sells.keys(), ...buys.keys()]);
  for (const chain of chains) {
    const s = (sells.get(chain) ?? []).map((l) => ({ ...l, rem: l.usd })).sort((a, b) => b.rem - a.rem);
    const b = (buys.get(chain) ?? []).map((l) => ({ ...l, rem: l.usd })).sort((a, b) => b.rem - a.rem);
    let i = 0;
    let j = 0;
    while (i < s.length && j < b.length) {
      const take = Math.min(s[i].rem, b[j].rem);
      if (s[i].token.address !== b[j].token.address) {
        const step = swapStep(s[i], { symbol: b[j].instrument, token: b[j].token }, take);
        if (step) steps.push(step);
      }
      s[i].rem -= take;
      b[j].rem -= take;
      if (s[i].rem < MIN_STEP_USD) i++;
      if (b[j].rem < MIN_STEP_USD) j++;
    }
    // Leftover sells: park in a stablecoin on this chain; the money is needed elsewhere.
    for (; i < s.length; i++) {
      const leg = s[i];
      surplus.set(chain, (surplus.get(chain) ?? 0) + leg.rem);
      if (isStable(leg.token.symbol)) continue;
      const usdc = resolveToken(chain, "USDC");
      const step = usdc && swapStep(leg, { symbol: "USDC", token: usdc }, leg.rem, true);
      if (step) steps.push(step);
    }
    for (; j < b.length; j++) deficits.push({ chain, buy: b[j], usd: b[j].rem });
  }

  // 4. Buys with nothing to fund them on their chain need a bridge: manual for now.
  const surplusNote = [...surplus.entries()]
    .filter(([, v]) => v >= MIN_STEP_USD)
    .map(([c, v]) => s.surplusOn(usd0(v), CHAIN_LABELS[c]))
    .join(", ");
  for (const d of deficits) {
    if (d.usd < MIN_STEP_USD) continue;
    steps.push({
      id: `manual:fund:${d.chain}:${d.buy.instrument}`,
      kind: "manual",
      where: CHAIN_LABELS[d.chain],
      title: s.fundTitle(CHAIN_LABELS[d.chain], usd0(d.usd), d.buy.instrument),
      detail: surplusNote
        ? s.fundWithSurplus(surplusNote, CHAIN_LABELS[d.chain], d.buy.instrument)
        : s.fundFromOutside(usd0(d.usd), CHAIN_LABELS[d.chain], d.buy.instrument),
      usd: d.usd,
      move: { action: "buy", asset: d.buy.asset },
    });
  }

  // Direct swaps first, then parking, then manual work.
  const rank = (st: Step) => (st.kind === "swap" ? (st.parkedUsd > 0 ? 1 : 0) : 2);
  return mergeSwaps(steps).sort((a, b) => rank(a) - rank(b) || stepUsd(b) - stepUsd(a));
}

export function stepUsd(step: Step): number {
  return step.kind === "swap" ? step.sell.usd : step.usd;
}
