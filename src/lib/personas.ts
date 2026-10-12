export interface Persona {
  id: string;
  name: string;
  tagline: string;
}

// Inspired by each investor's publicly stated philosophy. These are lenses, not endorsements.
// The philosophy each lens reasons from lives in the advisor service (mrmarket-labs/advisor).
export const PERSONAS: Persona[] = [
  {
    id: "munger",
    name: "Charlie Munger",
    tagline: "Concentrated, patient, avoid stupidity",
  },
  {
    id: "buffett",
    name: "Warren Buffett",
    tagline: "Margin of safety, cash ready for fear",
  },
  {
    id: "dalio",
    name: "Ray Dalio",
    tagline: "All Weather risk parity",
  },
  {
    id: "taleb",
    name: "Nassim Taleb",
    tagline: "Barbell: ultra-safe + small convex bets",
  },
  {
    id: "bogle",
    name: "Jack Bogle",
    tagline: "Own the market, minimize costs",
  },
  {
    id: "wood",
    name: "Cathie Wood",
    tagline: "High-conviction disruptive innovation",
  },
];

export function getPersona(id: string): Persona | undefined {
  return PERSONAS.find((p) => p.id === id);
}
