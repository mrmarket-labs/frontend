export type Chain =
  | "solana"
  | "bitcoin"
  | "ethereum"
  | "base"
  | "arbitrum"
  | "optimism"
  | "polygon"
  | "hyperliquid"
  | "hyperevm";

export type Category =
  | "stablecoin"
  | "bitcoin"
  | "ethereum"
  | "solana"
  | "large-cap"
  | "tokenized-stock"
  | "tokenized-gold"
  | "speculative";

export interface Holding {
  chain: Chain;
  address: string;
  symbol: string;
  name: string;
  /** Canonical asset the holding rolls up to (WBTC -> BTC, JitoSOL -> SOL). */
  asset: string;
  category: Category;
  amount: number;
  priceUsd: number;
  valueUsd: number;
  logo?: string;
}

export interface ScanError {
  address: string;
  chain?: Chain;
  message: string;
}

export interface PerpPosition {
  venue: "hyperliquid";
  coin: string;
  side: "long" | "short";
  notionalUsd: number;
  leverage: number;
  unrealizedPnlUsd: number;
  liquidationPx: number | null;
}

export interface PortfolioResponse {
  holdings: Holding[];
  /** Leveraged exposure on top of holdings; their margin is already counted in holdings. */
  positions: PerpPosition[];
  errors: ScanError[];
  totalUsd: number;
}

export interface AssetTrend {
  symbol: string;
  price: number;
  change30d: number;
  change90d: number;
  vsSma50: number;
  vsSma200: number;
  volatility30d: number;
  drawdownFromHigh: number;
}

export type Regime = "risk-on" | "neutral" | "risk-off";

export interface MarketSnapshot {
  asOf: string;
  regime: Regime;
  regimeScore: number;
  fearGreed: { value: number; label: string } | null;
  btcDominance: number | null;
  totalMarketCapUsd: number | null;
  marketCapChange24h: number | null;
  assets: AssetTrend[];
  notes: string[];
}

