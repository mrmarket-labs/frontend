import { info, spotPrices } from "./chains/hyperliquid";
import { cached } from "./http";

/** HIP-3 perp DEX run by trade.xyz on Hyperliquid: stock indices and commodities. */
const XYZ_DEX = "xyz";
const PERP_MARKETS = ["SP500", "XYZ100", "GOLD", "SILVER", "NVDA"];
const SPOT_TOKENS = ["XAUT0", "SPYX", "QQQX", "NVDAX"];
const HOURS_PER_YEAR = 24 * 365;

export interface SpotMarket {
  token: string;
  priceUsd: number;
  volume24hUsd: number;
}

export interface PerpMarket {
  market: string;
  priceUsd: number;
  volume24hUsd: number;
  /** Annualized funding a 1x long pays (negative = longs get paid). */
  longFundingApr: number;
  maxLeverage: number;
}

export interface HyperliquidVenues {
  spot: SpotMarket[];
  perps: PerpMarket[];
}

interface PerpMeta {
  universe: { name: string; maxLeverage: number; isDelisted?: boolean }[];
}
interface PerpCtx {
  markPx: string;
  dayNtlVlm: string;
  funding: string;
}

/** Live liquidity and funding for the Hyperliquid gold/stock markets the advisor may suggest. */
export function getHyperliquidVenues(): Promise<HyperliquidVenues | null> {
  return cached("hl-venues", 5 * 60_000, async () => {
    try {
      const [spotPx, [meta, ctxs]] = await Promise.all([
        spotPrices(),
        info<[PerpMeta, PerpCtx[]]>({ type: "metaAndAssetCtxs", dex: XYZ_DEX }),
      ]);
      const spot = SPOT_TOKENS.flatMap((token): SpotMarket[] => {
        const m = [...spotPx.values()].find((p) => p.name === token);
        return m ? [{ token, priceUsd: m.price, volume24hUsd: m.volume }] : [];
      });
      const perps = meta.universe.flatMap((u, i): PerpMarket[] => {
        const market = u.name.replace(`${XYZ_DEX}:`, "");
        if (u.isDelisted || !PERP_MARKETS.includes(market)) return [];
        const c = ctxs[i];
        return [{
          market,
          priceUsd: Number(c.markPx),
          volume24hUsd: Number(c.dayNtlVlm),
          longFundingApr: Number(c.funding) * HOURS_PER_YEAR * 100,
          maxLeverage: u.maxLeverage,
        }];
      });
      return { spot, perps };
    } catch {
      return null;
    }
  });
}
