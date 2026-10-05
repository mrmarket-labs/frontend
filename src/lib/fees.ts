import { cached, rpc } from "./http";

/** Swap fee Diversify charges, in basis points (50 = 0.5%). */
export const FEE_BPS = Number(process.env.SWAP_FEE_BPS || 50);
export const FEE_WALLET_SOLANA = process.env.FEE_WALLET_SOLANA || "";
export const FEE_WALLET_EVM = process.env.FEE_WALLET_EVM || "";

const SOLANA_RPC = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

/**
 * Jupiter pays fees into an existing token account of the fee wallet, for the input or output
 * mint. Returns that account, or null when the wallet has none for this mint (fee is then skipped).
 */
export function solanaFeeAccount(mint: string): Promise<string | null> {
  if (!FEE_WALLET_SOLANA) return Promise.resolve(null);
  return cached(`fee-ata:${mint}`, 10 * 60_000, async () => {
    const res = await rpc<{ value: { pubkey: string }[] }>(SOLANA_RPC, "getTokenAccountsByOwner", [
      FEE_WALLET_SOLANA,
      { mint },
      { encoding: "jsonParsed" },
    ]);
    return res.value[0]?.pubkey ?? null;
  });
}
