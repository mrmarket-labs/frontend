import { canonicalAsset, classify } from "../classify";
import { cached, getJson } from "../http";
import type { Holding, PerpPosition } from "../types";

const INFO_URL = "https://api.hyperliquid.xyz/info";
const MIN_VALUE_USD = 1;
/** Spot tokens trading less than this per day can't be sold near their mark price. */
const MIN_DAILY_VOLUME_USD = 1_000;
const USDC_TOKEN = 0;
/**
 * Modes where spot balances already include perps equity: perps accountValue shows up as part of
 * spot USDC "hold", unrealized PnL included. Adding accountValue on top would double count.
 */
const UNIFIED_MODES = new Set(["unifiedAccount", "portfolioMargin"]);

export function info<T>(body: Record<string, unknown>): Promise<T> {
  return getJson<T>(INFO_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

interface SpotMeta {
  tokens: { name: string; index: number; fullName: string | null }[];
  universe: { name: string; tokens: [number, number] }[];
}
interface SpotCtx {
  coin: string;
  markPx: string;
  dayNtlVlm: string;
}
interface SpotState {
  balances: { coin: string; token: number; total: string }[];
}
interface PerpState {
  marginSummary: { accountValue: string };
  assetPositions: {
    position: {
      coin: string;
      szi: string;
      positionValue: string;
      unrealizedPnl: string;
      liquidationPx: string | null;
      leverage: { type: string; value: number };
    };
  }[];
}
interface DelegatorSummary {
  delegated: string;
  undelegated: string;
  totalPendingWithdrawal: string;
}

/** USD mark price and daily volume per spot token index, from its /USDC pair. */
export function spotPrices(): Promise<Map<number, { price: number; volume: number; name: string }>> {
  return cached("hl-spot-prices", 60_000, async () => {
    const [meta, ctxs] = await info<[SpotMeta, SpotCtx[]]>({ type: "spotMetaAndAssetCtxs" });
    const ctxByPair = new Map(ctxs.map((c) => [c.coin, c]));
    const names = new Map(meta.tokens.map((t) => [t.index, t.name]));
    const prices = new Map<number, { price: number; volume: number; name: string }>();
    prices.set(USDC_TOKEN, { price: 1, volume: Infinity, name: "USDC" });
    for (const pair of meta.universe) {
      const [base, quote] = pair.tokens;
      const ctx = ctxByPair.get(pair.name);
      if (quote !== USDC_TOKEN || !ctx) continue;
      prices.set(base, { price: Number(ctx.markPx), volume: Number(ctx.dayNtlVlm), name: names.get(base) ?? pair.name });
    }
    return prices;
  });
}

function holding(address: string, symbol: string, name: string, amount: number, priceUsd: number): Holding {
  return {
    chain: "hyperliquid",
    address,
    symbol,
    name,
    asset: canonicalAsset(symbol),
    category: classify(symbol),
    amount,
    priceUsd,
    valueUsd: amount * priceUsd,
  };
}

export interface HyperliquidScan {
  holdings: Holding[];
  positions: PerpPosition[];
  ignored: number;
}

export async function scanHyperliquid(address: string): Promise<HyperliquidScan> {
  const [spot, perps, staking, mode, prices] = await Promise.all([
    info<SpotState>({ type: "spotClearinghouseState", user: address }),
    info<PerpState>({ type: "clearinghouseState", user: address }),
    info<DelegatorSummary>({ type: "delegatorSummary", user: address }).catch(() => null),
    info<string | null>({ type: "userAbstraction", user: address }).catch(() => null),
    spotPrices(),
  ]);
  const unified = mode != null && UNIFIED_MODES.has(mode);

  const positions: PerpPosition[] = perps.assetPositions.map(({ position: p }) => ({
    venue: "hyperliquid",
    coin: p.coin,
    side: Number(p.szi) >= 0 ? "long" : "short",
    notionalUsd: Number(p.positionValue),
    leverage: p.leverage.value,
    unrealizedPnlUsd: Number(p.unrealizedPnl),
    liquidationPx: p.liquidationPx ? Number(p.liquidationPx) : null,
  }));

  const holdings: Holding[] = [];
  let ignored = 0;
  for (const b of spot.balances) {
    const amount = Number(b.total);
    const quote = prices.get(b.token);
    if (!amount || !quote) continue;
    const h = holding(address, b.coin, b.token === USDC_TOKEN ? "USD Coin" : quote.name, amount, quote.price);
    if (h.valueUsd < MIN_VALUE_USD) continue;
    if (quote.volume < MIN_DAILY_VOLUME_USD) {
      ignored++;
      continue;
    }
    holdings.push(h);
  }

  // Standard ("disabled") accounts keep perps equity in a separate balance from spot.
  const perpEquity = Number(perps.marginSummary.accountValue);
  if (!unified && perpEquity >= MIN_VALUE_USD) {
    holdings.push(holding(address, "USDC", "Perps margin (USDC)", perpEquity, 1));
  }

  const staked = staking
    ? Number(staking.delegated) + Number(staking.undelegated) + Number(staking.totalPendingWithdrawal)
    : 0;
  const hype = [...prices.values()].find((p) => p.name === "HYPE");
  if (staked > 0 && hype && staked * hype.price >= MIN_VALUE_USD) {
    holdings.push(holding(address, "HYPE", "Staked HYPE", staked, hype.price));
  }

  return { holdings, positions, ignored };
}
