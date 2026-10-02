import { getJson } from "../http";
import { coingeckoPrices } from "../prices";
import type { Holding } from "../types";

interface MempoolAddress {
  chain_stats: { funded_txo_sum: number; spent_txo_sum: number; tx_count: number };
  mempool_stats: { funded_txo_sum: number; spent_txo_sum: number; tx_count: number };
}

interface BlockbookXpub {
  balance: string;
  unconfirmedBalance?: string;
  txs: number;
}

// Public Blockbook instances (run by Trezor) derive every address under an xpub/ypub/zpub.
// btc1 is occasionally slow on first derivation, so it gets a second try.
const BLOCKBOOK_HOSTS = ["https://btc1.trezor.io", "https://btc2.trezor.io", "https://btc1.trezor.io"];

export function isBitcoinAddress(address: string): boolean {
  return /^(bc1[02-9ac-hj-np-z]{11,87}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/.test(normalizeBitcoin(address));
}

export function isBitcoinXpub(key: string): boolean {
  return /^[xyz]pub[1-9A-HJ-NP-Za-km-z]{100,112}$/.test(key);
}

/** Bech32 addresses are case-insensitive; some wallets and QR codes emit uppercase. */
export function normalizeBitcoin(address: string): string {
  return /^bc1/i.test(address) ? address.toLowerCase() : address;
}

function holding(address: string, sats: number, price: number): Holding[] {
  if (sats <= 0) return [];
  const amount = sats / 1e8;
  return [{
    chain: "bitcoin",
    address,
    symbol: "BTC",
    name: "Bitcoin",
    asset: "BTC",
    category: "bitcoin",
    amount,
    priceUsd: price,
    valueUsd: amount * price,
  }];
}

export interface BitcoinScan {
  holdings: Holding[];
  /** Explains an empty result so the user knows what to paste instead. */
  note?: string;
}

export async function scanBitcoin(input: string): Promise<BitcoinScan> {
  const address = normalizeBitcoin(input);
  const [data, prices] = await Promise.all([
    getJson<MempoolAddress>(`https://mempool.space/api/address/${address}`),
    coingeckoPrices(["bitcoin"]),
  ]);
  const sats =
    data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum +
    data.mempool_stats.funded_txo_sum - data.mempool_stats.spent_txo_sum;
  const holdings = holding(address, sats, prices.bitcoin ?? 0);
  if (holdings.length > 0) return { holdings };

  const neverUsed = data.chain_stats.tx_count + data.mempool_stats.tx_count === 0;
  const hint = address.startsWith("bc1p")
    ? "This looks like an Ordinals/Taproot address. Wallets like Xverse, Phantom and Unisat keep BTC in a separate payment address (bc1q… or 3…), so paste that too."
    : "If you use Ledger, Trezor or Sparrow, paste your account xpub/zpub to include every address.";
  return {
    holdings,
    note: `${neverUsed ? "This address has never received BTC." : "This address is empty now; its BTC moved to other addresses."} ${hint}`,
  };
}

export async function scanBitcoinXpub(xpub: string): Promise<BitcoinScan> {
  let lastError: unknown;
  for (const host of BLOCKBOOK_HOSTS) {
    try {
      const [data, prices] = await Promise.all([
        getJson<BlockbookXpub>(`${host}/api/v2/xpub/${xpub}?details=basic`, { headers: { "user-agent": "Mozilla/5.0" } }),
        coingeckoPrices(["bitcoin"]),
      ]);
      const sats = Number(data.balance) + Number(data.unconfirmedBalance ?? 0);
      const holdings = holding(xpub, sats, prices.bitcoin ?? 0);
      return holdings.length > 0
        ? { holdings }
        : { holdings, note: data.txs === 0 ? "This key has no transactions." : "This wallet's balance is 0 BTC." };
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}
