import type { Category } from "./types";

const STABLES = new Set([
  "USDC", "USDT", "DAI", "USDS", "PYUSD", "USDE", "FDUSD", "TUSD", "USDG",
  "USD1", "RLUSD", "FRAX", "LUSD", "GHO", "USDC.E", "USDBC", "AUSD",
  "USDT0", "USDH", "USDHL", "FEUSD",
]);
const GOLD = new Set(["PAXG", "XAUT", "XAUT0"]);

/** Wrapped / staked variants that roll up to a canonical asset. */
const ALIASES: Record<string, string> = {
  WBTC: "BTC", CBBTC: "BTC", UBTC: "BTC", TBTC: "BTC", ZBTC: "BTC", LBTC: "BTC",
  WETH: "ETH", STETH: "ETH", UETH: "ETH", WSTETH: "ETH", RETH: "ETH", CBETH: "ETH",
  WEETH: "ETH", METH: "ETH",
  WSOL: "SOL", USOL: "SOL", JITOSOL: "SOL", MSOL: "SOL", JUPSOL: "SOL", BSOL: "SOL",
  INF: "SOL", BNSOL: "SOL", HSOL: "SOL", DSOL: "SOL", JSOL: "SOL",
  "USDC.E": "USDC", USDBC: "USDC", USDT0: "USDT",
  POL: "POL", MATIC: "POL", XAUT0: "XAUT",
};

const LARGE_CAPS = new Set([
  "BNB", "XRP", "ADA", "AVAX", "LINK", "DOT", "TRX", "TON", "SUI", "LTC",
  "BCH", "NEAR", "UNI", "AAVE", "HYPE", "ARB", "OP", "POL", "JUP", "ATOM",
]);

export function canonicalAsset(symbol: string): string {
  const s = symbol.toUpperCase();
  return ALIASES[s] ?? s;
}

export function classify(symbol: string, tags: string[] = []): Category {
  const s = symbol.toUpperCase();
  const asset = canonicalAsset(s);
  if (STABLES.has(s) || tags.includes("stable")) return "stablecoin";
  if (GOLD.has(s) || tags.includes("commodities")) return "tokenized-gold";
  if (tags.includes("xstocks") || tags.includes("stocks") || tags.includes("equities"))
    return "tokenized-stock";
  if (asset === "BTC") return "bitcoin";
  if (asset === "ETH") return "ethereum";
  if (asset === "SOL" || tags.includes("lst")) return "solana";
  if (LARGE_CAPS.has(asset)) return "large-cap";
  return "speculative";
}

export const CATEGORY_LABELS: Record<Category, string> = {
  stablecoin: "Stablecoins",
  bitcoin: "Bitcoin",
  ethereum: "Ethereum",
  solana: "Solana",
  "large-cap": "Large-cap alts",
  "tokenized-stock": "Tokenized stocks",
  "tokenized-gold": "Tokenized gold",
  speculative: "Speculative",
};
