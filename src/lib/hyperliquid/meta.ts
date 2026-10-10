/** Server-side view of Hyperliquid's spot universe, so any listed token can be sold, not only curated ones. */
import { info } from "../chains/hyperliquid";
import { cached } from "../http";
import { HL_USDC_INDEX } from "./spot";

export interface SpotTokenMeta {
  index: number;
  name: string;
  szDecimals: number;
  /** The token's /USDC pair, if it has one. */
  pair: { index: number; name: string } | null;
}

interface SpotMeta {
  tokens: { name: string; index: number; szDecimals: number }[];
  universe: { name: string; tokens: [number, number]; index: number }[];
}

export function getSpotTokens(): Promise<Map<number, SpotTokenMeta>> {
  return cached("hl-spot-meta", 10 * 60_000, async () => {
    const meta = await info<SpotMeta>({ type: "spotMeta" });
    const pairs = new Map<number, { index: number; name: string }>();
    for (const p of meta.universe) if (p.tokens[1] === HL_USDC_INDEX) pairs.set(p.tokens[0], { index: p.index, name: p.name });
    return new Map(meta.tokens.map((t) => [t.index, { index: t.index, name: t.name, szDecimals: t.szDecimals, pair: pairs.get(t.index) ?? null }]));
  });
}

export interface BookLevel {
  px: number;
  sz: number;
}

/** Bids and asks for a pair, best first. */
export async function getBook(pairName: string): Promise<{ bids: BookLevel[]; asks: BookLevel[] }> {
  const book = await info<{ levels: [{ px: string; sz: string }[], { px: string; sz: string }[]] }>({ type: "l2Book", coin: pairName });
  const parse = (side: { px: string; sz: string }[]) => side.map((l) => ({ px: Number(l.px), sz: Number(l.sz) }));
  return { bids: parse(book.levels[0]), asks: parse(book.levels[1]) };
}

/** Fee rate (in tenths of a basis point) the user has approved for a builder; 0 if none. */
export async function approvedBuilderFee(user: string, builder: string): Promise<number> {
  const n = await info<number>({ type: "maxBuilderFee", user, builder: builder.toLowerCase() });
  return Number(n) || 0;
}
