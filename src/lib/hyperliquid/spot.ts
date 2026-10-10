/**
 * Hyperliquid spot, shared by server and client. Tokens are identified by their index on the
 * exchange, carried in the app as the pseudo-address `hl:<index>`; every curated pair trades
 * against USDC. Indices never change once a token is listed, so the table is safe to pin.
 */
import type { TokenInfo } from "../tokens";

export const HL_PREFIX = "hl:";
export const HL_USDC_INDEX = 0;
/** Spot orders address a pair by 10000 + its index in the spot universe. */
export const SPOT_ASSET_BASE = 10000;
/** Spot prices may carry at most 8 decimals, less the token's size decimals. */
const SPOT_MAX_DECIMALS = 8;
const PRICE_SIG_FIGS = 5;
/** The exchange rejects orders worth less than this. */
export const HL_MIN_ORDER_USD = 10;

export interface SpotToken {
  symbol: string;
  index: number;
  szDecimals: number;
  /** Index and name of the token's /USDC pair; USDC itself has none. */
  pairIndex: number | null;
  pairName: string | null;
}

/** Tokens the advisor may suggest on Hyperliquid spot (indices read from spotMeta on 2026-10-10). */
export const HL_SPOT_TOKENS: SpotToken[] = [
  { symbol: "USDC", index: 0, szDecimals: 8, pairIndex: null, pairName: null },
  { symbol: "HYPE", index: 150, szDecimals: 2, pairIndex: 107, pairName: "@107" },
  { symbol: "UBTC", index: 197, szDecimals: 5, pairIndex: 142, pairName: "@142" },
  { symbol: "UETH", index: 221, szDecimals: 4, pairIndex: 151, pairName: "@151" },
  { symbol: "USOL", index: 254, szDecimals: 3, pairIndex: 156, pairName: "@156" },
  { symbol: "USDT0", index: 268, szDecimals: 2, pairIndex: 166, pairName: "@166" },
  { symbol: "XAUT0", index: 297, szDecimals: 2, pairIndex: 182, pairName: "@182" },
  { symbol: "USPYX", index: 312, szDecimals: 2, pairIndex: 189, pairName: "@189" },
  { symbol: "NVDAX", index: 845, szDecimals: 2, pairIndex: 702, pairName: "@702" },
  { symbol: "SPYX", index: 846, szDecimals: 2, pairIndex: 703, pairName: "@703" },
  { symbol: "QQQX", index: 847, szDecimals: 2, pairIndex: 704, pairName: "@704" },
  { symbol: "TSLAX", index: 855, szDecimals: 2, pairIndex: 712, pairName: "@712" },
  { symbol: "AAPLX", index: 856, szDecimals: 2, pairIndex: 713, pairName: "@713" },
  { symbol: "CRCLX", index: 857, szDecimals: 2, pairIndex: 714, pairName: "@714" },
];

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

export const hlAddress = (index: number) => `${HL_PREFIX}${index}`;

export function hlIndexOf(address: string): number | null {
  if (!address.startsWith(HL_PREFIX)) return null;
  const n = Number(address.slice(HL_PREFIX.length));
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export function hlTokenInfo(symbol: string): TokenInfo | null {
  const t = HL_SPOT_TOKENS.find((x) => x.symbol === symbol.toUpperCase());
  return t ? { symbol: t.symbol, address: hlAddress(t.index), decimals: t.szDecimals } : null;
}

/* --- Wire formats --------------------------------------------------------------------- */

/** Numbers go on the wire as decimal strings with no trailing zeros, exactly as the official SDKs send them. */
export function floatToWire(x: number): string {
  const s = x.toFixed(8).replace(/\.?0+$/, "");
  return s === "-0" || s === "" ? "0" : s;
}

/** Sizes are truncated, never rounded up, so a sell never exceeds the balance. */
export function roundSize(size: number, szDecimals: number): number {
  const f = 10 ** szDecimals;
  return Math.floor(size * f + 1e-9) / f;
}

/** Five significant figures and at most (8 - szDecimals) decimals; whole numbers are always valid. */
export function roundPrice(px: number, szDecimals: number): number {
  const sig = Number(px.toPrecision(PRICE_SIG_FIGS));
  return Number(sig.toFixed(Math.max(0, SPOT_MAX_DECIMALS - szDecimals)));
}
