import { isBitcoinAddress, isBitcoinXpub, scanBitcoin, scanBitcoinXpub, type BitcoinScan } from "./chains/bitcoin";
import { isEvmAddress, scanEvm } from "./chains/evm";
import { isSolanaAddress, scanSolana } from "./chains/solana";
import type { Holding, PortfolioResponse, ScanError } from "./types";

export const MAX_ADDRESSES = 20;

export function parseAddresses(input: string): string[] {
  return [...new Set(input.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))];
}

async function scanOne(address: string): Promise<{ holdings: Holding[]; errors: ScanError[] }> {
  try {
    // Order matters: BTC legacy addresses are also valid base58, so check BTC before Solana.
    if (isEvmAddress(address)) {
      const { holdings, failedChains } = await scanEvm(address);
      return {
        holdings,
        errors: failedChains.map((chain) => ({ address, chain, message: `Could not reach ${chain} RPC` })),
      };
    }
    const btc = (r: BitcoinScan) => ({
      holdings: r.holdings,
      errors: r.note ? [{ address, chain: "bitcoin" as const, message: r.note }] : [],
    });
    if (isBitcoinXpub(address)) return btc(await scanBitcoinXpub(address));
    if (isBitcoinAddress(address)) return btc(await scanBitcoin(address));
    if (isSolanaAddress(address)) {
      const { holdings, ignored } = await scanSolana(address);
      const note = `Skipped ${ignored} unverified or illiquid token${ignored === 1 ? "" : "s"} (likely spam)`;
      return { holdings, errors: ignored ? [{ address, chain: "solana", message: note }] : [] };
    }
    return { holdings: [], errors: [{ address, message: "Unrecognized address format" }] };
  } catch (e) {
    return { holdings: [], errors: [{ address, message: e instanceof Error ? e.message : String(e) }] };
  }
}

export async function scanPortfolio(addresses: string[]): Promise<PortfolioResponse> {
  const results = await Promise.all(addresses.map(scanOne));
  const holdings = results.flatMap((r) => r.holdings).sort((a, b) => b.valueUsd - a.valueUsd);
  return {
    holdings,
    errors: results.flatMap((r) => r.errors),
    totalUsd: holdings.reduce((sum, h) => sum + h.valueUsd, 0),
  };
}
