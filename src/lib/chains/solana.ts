import { canonicalAsset, classify } from "../classify";
import { chunk, getJson, rpc } from "../http";
import type { Holding } from "../types";

const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const TOKEN_PROGRAMS = [
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", // Token-2022 (xStocks live here)
];
const WSOL_MINT = "So11111111111111111111111111111111111111112";
const MIN_VALUE_USD = 1;
/** A position bigger than this share of the token's DEX liquidity can't be sold near the quoted price. */
const MAX_SHARE_OF_LIQUIDITY = 0.25;

interface JupToken {
  id: string;
  name: string;
  symbol: string;
  icon?: string;
  tags?: string[];
  usdPrice?: number;
  isVerified?: boolean;
  liquidity?: number;
}

interface TokenAccount {
  account: {
    data: {
      parsed: { info: { mint: string; tokenAmount: { uiAmount: number | null } } };
    };
  };
}

export function isSolanaAddress(address: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
}

async function jupiterTokens(mints: string[]): Promise<Map<string, JupToken>> {
  const out = new Map<string, JupToken>();
  for (const group of chunk(mints, 100)) {
    const tokens = await getJson<JupToken[]>(
      `https://lite-api.jup.ag/tokens/v2/search?query=${group.join(",")}`,
    );
    for (const t of tokens) out.set(t.id, t);
  }
  return out;
}

export async function scanSolana(address: string): Promise<{ holdings: Holding[]; ignored: number }> {
  const [lamports, ...tokenAccounts] = await Promise.all([
    rpc<{ value: number }>(RPC_URL, "getBalance", [address]),
    ...TOKEN_PROGRAMS.map((programId) =>
      rpc<{ value: TokenAccount[] }>(RPC_URL, "getTokenAccountsByOwner", [
        address,
        { programId },
        { encoding: "jsonParsed" },
      ]),
    ),
  ]);

  const balances = new Map<string, number>();
  balances.set(WSOL_MINT, lamports.value / 1e9);
  for (const { account } of tokenAccounts.flatMap((r) => r.value)) {
    const { mint, tokenAmount } = account.data.parsed.info;
    if (!tokenAmount.uiAmount) continue;
    balances.set(mint, (balances.get(mint) ?? 0) + tokenAmount.uiAmount);
  }

  const meta = await jupiterTokens([...balances.keys()]);
  const holdings: Holding[] = [];
  let ignored = 0;
  for (const [mint, amount] of balances) {
    const token = meta.get(mint);
    // Unpriced or unknown tokens are almost always airdropped spam.
    if (!token?.usdPrice) continue;
    const valueUsd = amount * token.usdPrice;
    if (valueUsd < MIN_VALUE_USD) continue;
    // Spam airdrops often carry a price from a tiny pool; that value isn't real.
    const illiquid = mint !== WSOL_MINT && valueUsd > (token.liquidity ?? 0) * MAX_SHARE_OF_LIQUIDITY;
    if (!token.isVerified || illiquid) {
      ignored++;
      continue;
    }
    const symbol = mint === WSOL_MINT ? "SOL" : token.symbol;
    holdings.push({
      chain: "solana",
      address,
      symbol,
      name: mint === WSOL_MINT ? "Solana" : token.name,
      // Liquid staking tokens (JitoSOL, mSOL, ...) are economically SOL.
      asset: token.tags?.includes("lst") ? "SOL" : canonicalAsset(symbol),
      category: classify(symbol, token.tags),
      amount,
      priceUsd: token.usdPrice,
      valueUsd,
      logo: token.icon,
    });
  }
  return { holdings, ignored };
}
