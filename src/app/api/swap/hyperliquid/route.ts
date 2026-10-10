import { z } from "zod/v4";
import { FEE_BPS, HYPERLIQUID_BUILDER } from "@/lib/fees";
import { approvedBuilderFee, getBook, getSpotTokens, type BookLevel, type SpotTokenMeta } from "@/lib/hyperliquid/meta";
import { HL_MIN_ORDER_USD, HL_USDC_INDEX, SPOT_ASSET_BASE, floatToWire, hlIndexOf, roundPrice, roundSize } from "@/lib/hyperliquid/spot";
import { dict, localeFromRequest } from "@/lib/i18n";
import { clientIp, hit, tooMany } from "@/lib/limits";

/** Immediate-or-cancel orders are priced this far past the expected fill so they still match if the book moves. */
const SLIPPAGE = 0.005;
/** Hyperliquid's own taker fee on spot, used only to estimate what a two-leg swap has left for its second leg. */
const TAKER_FEE = 0.0007;

const RequestSchema = z.object({
  sellToken: z.string().regex(/^hl:\d+$/),
  buyToken: z.string().regex(/^hl:\d+$/),
  amount: z.number().positive().finite(),
  user: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
});

/** One order the client will sign: everything the wire format needs, plus what the user sees. */
export interface HyperliquidLeg {
  asset: number;
  pairName: string;
  isBuy: boolean;
  /** Base token size, already rounded to the token's size decimals. */
  size: number;
  szDecimals: number;
  limitPx: string;
  expectedPx: number;
  /** What this leg yields: USDC for a sell, base token for a buy. */
  expectedOut: number;
}

/** Walk one side of the book; returns the average price and how much base was matched. */
function walk(levels: BookLevel[], want: { base?: number; quote?: number }): { avgPx: number; base: number } | null {
  let base = 0;
  let quote = 0;
  for (const l of levels) {
    const takeBase = want.base != null ? Math.min(l.sz, want.base - base) : Math.min(l.sz, (want.quote! - quote) / l.px);
    base += takeBase;
    quote += takeBase * l.px;
    if ((want.base != null && base >= want.base - 1e-12) || (want.quote != null && quote >= want.quote - 1e-9)) return { avgPx: quote / base, base };
  }
  return null;
}

async function sellLeg(token: SpotTokenMeta, amount: number): Promise<HyperliquidLeg | "noLiquidity"> {
  const { bids } = await getBook(token.pair!.name);
  const size = roundSize(amount, token.szDecimals);
  const fill = walk(bids, { base: size });
  if (!fill) return "noLiquidity";
  const limitPx = roundPrice(fill.avgPx * (1 - SLIPPAGE), token.szDecimals);
  return { asset: SPOT_ASSET_BASE + token.pair!.index, pairName: token.pair!.name, isBuy: false, size, szDecimals: token.szDecimals, limitPx: floatToWire(limitPx), expectedPx: fill.avgPx, expectedOut: size * fill.avgPx };
}

async function buyLeg(token: SpotTokenMeta, usdc: number): Promise<HyperliquidLeg | "noLiquidity"> {
  const { asks } = await getBook(token.pair!.name);
  const probe = walk(asks, { quote: usdc });
  if (!probe) return "noLiquidity";
  const limitPx = roundPrice(probe.avgPx * (1 + SLIPPAGE), token.szDecimals);
  // Size so that even at the limit the order spends no more USDC than there is.
  const size = roundSize(usdc / limitPx, token.szDecimals);
  return { asset: SPOT_ASSET_BASE + token.pair!.index, pairName: token.pair!.name, isBuy: true, size, szDecimals: token.szDecimals, limitPx: floatToWire(limitPx), expectedPx: probe.avgPx, expectedOut: size };
}

export async function POST(request: Request) {
  const t = dict(localeFromRequest(request)).api;
  const limit = await hit(`swap:ip:${clientIp(request)}:${Math.floor(Date.now() / 3_600_000)}`, 120, 3600);
  if (!limit.ok) return tooMany(t.tooManyQuotes, limit.retryAfterSec);
  const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: t.invalidSwap }, { status: 400 });
  const { sellToken, buyToken, amount, user } = parsed.data;
  const sellIndex = hlIndexOf(sellToken)!;
  const buyIndex = hlIndexOf(buyToken)!;
  if (sellIndex === buyIndex) return Response.json({ error: t.invalidSwap }, { status: 400 });

  try {
    const tokens = await getSpotTokens();
    const sell = tokens.get(sellIndex);
    const buy = tokens.get(buyIndex);
    if (!sell || !buy || (sellIndex !== HL_USDC_INDEX && !sell.pair) || (buyIndex !== HL_USDC_INDEX && !buy.pair))
      return Response.json({ error: t.invalidSwap }, { status: 400 });

    // Everything trades against USDC: sell to USDC, buy from USDC, or both in turn.
    const legs: HyperliquidLeg[] = [];
    let usdc = amount;
    if (sellIndex !== HL_USDC_INDEX) {
      const leg = await sellLeg(sell, amount);
      if (leg === "noLiquidity") return Response.json({ error: t.noLiquidity }, { status: 409 });
      legs.push(leg);
      usdc = leg.expectedOut * (1 - TAKER_FEE);
    }
    if (buyIndex !== HL_USDC_INDEX) {
      const leg = await buyLeg(buy, usdc);
      if (leg === "noLiquidity") return Response.json({ error: t.noLiquidity }, { status: 409 });
      legs.push(leg);
    }
    const notional = legs[0].isBuy ? usdc : legs[0].expectedOut;
    if (notional < HL_MIN_ORDER_USD) return Response.json({ error: t.orderTooSmall(HL_MIN_ORDER_USD) }, { status: 409 });

    const last = legs[legs.length - 1];
    const bestPx = (leg: HyperliquidLeg, book: BookLevel[]) => book[0]?.px ?? leg.expectedPx;
    const books = await Promise.all(legs.map((l) => getBook(l.pairName)));
    const impact = Math.max(...legs.map((l, i) => Math.abs(l.expectedPx - bestPx(l, l.isBuy ? books[i].asks : books[i].bids)) / l.expectedPx)) * 100;

    let builder: { address: string; feeTenthsBp: number; maxFeeRate: string; approved: boolean } | null = null;
    if (HYPERLIQUID_BUILDER) {
      const feeTenthsBp = FEE_BPS * 10;
      const approved = await approvedBuilderFee(user, HYPERLIQUID_BUILDER).catch(() => 0);
      builder = { address: HYPERLIQUID_BUILDER, feeTenthsBp, maxFeeRate: `${FEE_BPS / 100}%`, approved: approved >= feeTenthsBp };
    }

    return Response.json({
      legs,
      receive: last.expectedOut,
      // A sell can fill down to its limit; a buy is sized so the quantity is fixed.
      minReceive: last.isBuy ? last.size : last.size * Number(last.limitPx),
      priceImpactPct: impact,
      feeBps: builder ? FEE_BPS : 0,
      feeUsd: builder ? (notional * FEE_BPS) / 10_000 : 0,
      route: legs.map((l) => (l.isBuy ? `USDC → ${buy.name}` : `${sell.name} → USDC`)),
      builder,
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : t.couldNotQuote }, { status: 502 });
  }
}
