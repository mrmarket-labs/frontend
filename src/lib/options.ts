export const RISK_LEVELS = ["conservative", "balanced", "aggressive"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

/** How often the user wants to touch the portfolio. The app assumes a multi-year hold; this sets how much upkeep the plan may need. */
export const CADENCES = ["rarely", "quarterly", "monthly"] as const;
export type Cadence = (typeof CADENCES)[number];

export const VENUES = ["bitcoin", "ethereum", "ethereum-l2", "solana", "hyperliquid-spot", "hyperliquid-perp"] as const;
export type Venue = (typeof VENUES)[number];

