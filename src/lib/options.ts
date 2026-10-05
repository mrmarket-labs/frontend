export const RISK_LEVELS = ["conservative", "balanced", "aggressive"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const HORIZONS = ["under 1 year", "1-3 years", "3+ years"] as const;
export type Horizon = (typeof HORIZONS)[number];

export const VENUES = ["bitcoin", "ethereum", "ethereum-l2", "solana", "hyperliquid-spot", "hyperliquid-perp"] as const;
export type Venue = (typeof VENUES)[number];

export const VENUE_LABELS: Record<Venue, string> = {
  bitcoin: "Bitcoin",
  ethereum: "Ethereum",
  "ethereum-l2": "Ethereum L2",
  solana: "Solana",
  "hyperliquid-spot": "Hyperliquid spot",
  "hyperliquid-perp": "Hyperliquid perps (trade.xyz)",
};
