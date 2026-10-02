export type Chain =
  | "solana"
  | "bitcoin"
  | "ethereum"
  | "base"
  | "arbitrum"
  | "optimism"
  | "polygon";

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

export interface PortfolioResponse {
  holdings: Holding[];
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

