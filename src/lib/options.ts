export const RISK_LEVELS = ["conservative", "balanced", "aggressive"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const HORIZONS = ["under 1 year", "1-3 years", "3+ years"] as const;
export type Horizon = (typeof HORIZONS)[number];
