import { isBitcoinAddress, isBitcoinXpub, scanBitcoin, scanBitcoinXpub, type BitcoinScan } from "./chains/bitcoin";
import { isEvmAddress, scanEvm } from "./chains/evm";
import { scanHyperliquid } from "./chains/hyperliquid";
import { isSolanaAddress, scanSolana } from "./chains/solana";
import type { Holding, PerpPosition, PortfolioResponse, ScanError } from "./types";

export const MAX_ADDRESSES = 20;

export function parseAddresses(input: string): string[] {
  return [...new Set(input.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))];
}

async function scanOne(address: string): Promise<{ holdings: Holding[]; positions?: PerpPosition[]; errors: ScanError[] }> {
  try {
    // Order matters: BTC legacy addresses are also valid base58, so check BTC before Solana.
    if (isEvmAddress(address)) {
      // Hyperliquid accounts are keyed by the same 0x address.
      const [evm, hl] = await Promise.all([scanEvm(address), scanHyperliquid(address).catch(() => null)]);
      const errors: ScanError[] = evm.failedChains.map(({ chain, reason }) => ({ address, chain, message: `Could not scan ${chain}: ${reason}` }));
      if (!hl) errors.push({ address, chain: "hyperliquid", message: "Could not reach Hyperliquid" });
      else if (hl.ignored)
        errors.push({ address, chain: "hyperliquid", message: `Skipped ${hl.ignored} illiquid Hyperliquid spot token${hl.ignored === 1 ? "" : "s"}` });
      return { holdings: [...evm.holdings, ...(hl?.holdings ?? [])], positions: hl?.positions ?? [], errors };
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
    positions: results.flatMap((r) => r.positions ?? []).sort((a, b) => b.notionalUsd - a.notionalUsd),
    errors: results.flatMap((r) => r.errors),
    totalUsd: holdings.reduce((sum, h) => sum + h.valueUsd, 0),
  };
}
