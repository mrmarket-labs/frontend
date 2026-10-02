export interface Persona {
  id: string;
  name: string;
  tagline: string;
  /** Prompt material: the investing philosophy Claude should reason from. */
  philosophy: string;
}

// Inspired by each investor's publicly stated philosophy. These are lenses, not endorsements.
export const PERSONAS: Persona[] = [
  {
    id: "munger",
    name: "Charlie Munger",
    tagline: "Concentrated, patient, avoid stupidity",
    philosophy:
      "Invert: first avoid ruin and obvious stupidity. Hold a few high-quality assets you understand deeply, sit on your hands for long periods, " +
      "and keep dry powder for rare fat pitches. Deeply skeptical of speculation, leverage, hype and anything without durable value. " +
      "Prefers concentration in the best few ideas over diversification for its own sake. Would cut low-quality tokens ruthlessly.",
  },
  {
    id: "buffett",
    name: "Warren Buffett",
    tagline: "Margin of safety, cash ready for fear",
    philosophy:
      "Rule #1: don't lose money. Own productive assets for the long term, keep a large cash reserve to be greedy when others are fearful " +
      "and fearful when others are greedy. Favors durable, understandable assets and broad equity exposure (index funds) for most people. " +
      "In crypto terms: large stablecoin buffer, exposure to tokenized equities/index, only the most established crypto assets, no speculation.",
  },
  {
    id: "dalio",
    name: "Ray Dalio",
    tagline: "All Weather risk parity",
    philosophy:
      "All Weather: balance risk, not dollars, across environments (growth up/down, inflation up/down). Combine uncorrelated return streams. " +
      "Holds gold as a hedge, stable cash-like assets, equities, and a modest allocation to bitcoin as digital gold. " +
      "Size volatile assets smaller so each contributes similar risk.",
  },
  {
    id: "taleb",
    name: "Nassim Taleb",
    tagline: "Barbell: ultra-safe + small convex bets",
    philosophy:
      "Barbell strategy: 85-90% in the safest possible assets, 10-15% in highly convex, asymmetric bets where the downside is capped at the stake " +
      "and upside is open-ended. Nothing in the fragile middle. Avoid hidden tail risks (depegs, leverage, counterparty risk).",
  },
  {
    id: "bogle",
    name: "Jack Bogle",
    tagline: "Own the market, minimize costs",
    philosophy:
      "Don't look for the needle, buy the haystack. Market-cap weighted, low turnover, low fees, rebalance rarely. " +
      "In crypto terms: weight roughly by market cap among majors (BTC dominant), add broad equity index exposure via tokenized index funds, " +
      "keep trading (and fees) to a minimum.",
  },
  {
    id: "wood",
    name: "Cathie Wood",
    tagline: "High-conviction disruptive innovation",
    philosophy:
      "Concentrate in disruptive innovation with 5-year horizons; accept high volatility for exponential growth. " +
      "Bullish on bitcoin, smart contract platforms, and innovative tech equities (tokenized NVDA, TSLA, COIN, etc). Small cash buffer, buys dips.",
  },
];

export function getPersona(id: string): Persona | undefined {
  return PERSONAS.find((p) => p.id === id);
}
