import { VersionedTransaction } from "@solana/web3.js";
import type { Eip1193Provider, WalletAddress } from "./types";

interface PhantomSolana {
  isPhantom?: boolean;
  publicKey: { toString(): string } | null;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toString(): string } }>;
  signAndSendTransaction(tx: VersionedTransaction, opts?: { skipPreflight?: boolean }): Promise<{ signature: string }>;
  signTransaction(tx: VersionedTransaction): Promise<VersionedTransaction>;
}
interface PhantomBitcoin {
  requestAccounts(): Promise<{ address: string; addressType: string; purpose: "payment" | "ordinals" }[]>;
}
interface PhantomWindow {
  phantom?: { solana?: PhantomSolana; ethereum?: Eip1193Provider; bitcoin?: PhantomBitcoin };
}

const win = () => (typeof window === "undefined" ? undefined : (window as unknown as PhantomWindow).phantom);

export function hasPhantom(): boolean {
  return Boolean(win()?.solana?.isPhantom);
}

export function phantomEvmProvider(): Eip1193Provider | null {
  return win()?.ethereum ?? null;
}

/**
 * One Phantom connection yields every chain the user enabled: Solana, Ethereum and both Bitcoin
 * accounts (payment + ordinals). Chains the user hasn't enabled simply return nothing.
 */
export async function connectPhantom(opts: { onlyIfTrusted?: boolean } = {}): Promise<WalletAddress[]> {
  const p = win();
  if (!p?.solana) throw new Error("Phantom isn't installed.");
  const out: WalletAddress[] = [];

  const sol = await p.solana.connect(opts.onlyIfTrusted ? { onlyIfTrusted: true } : undefined);
  out.push({ kind: "solana", address: sol.publicKey.toString() });

  if (p.ethereum) {
    try {
      const accounts = (await p.ethereum.request({ method: opts.onlyIfTrusted ? "eth_accounts" : "eth_requestAccounts" })) as string[];
      for (const a of accounts) out.push({ kind: "evm", address: a.toLowerCase() });
    } catch {}
  }
  // Phantom's injected Bitcoin provider is deprecated but still the only keyless way to read its addresses.
  if (p.bitcoin && !opts.onlyIfTrusted) {
    try {
      for (const a of await p.bitcoin.requestAccounts()) out.push({ kind: "bitcoin", address: a.address.toLowerCase(), note: a.purpose });
    } catch {}
  }
  return out;
}

/** Sign only; the app broadcasts and rebroadcasts the bytes itself so the swap can't be dropped silently. */
export async function phantomSignSolana(txBase64: string, expectedPublicKey: string): Promise<string> {
  const p = win();
  if (!p?.solana) throw new Error("Phantom isn't installed.");
  if (p.solana.publicKey?.toString() !== expectedPublicKey) {
    const { publicKey } = await p.solana.connect();
    if (publicKey.toString() !== expectedPublicKey)
      throw new Error(`Phantom is on a different account. Switch to ${expectedPublicKey.slice(0, 4)}…${expectedPublicKey.slice(-4)} and retry.`);
  }
  const bytes = Uint8Array.from(atob(txBase64), (c) => c.charCodeAt(0));
  const signed = await p.solana.signTransaction(VersionedTransaction.deserialize(bytes));
  return btoa(String.fromCharCode(...signed.serialize()));
}

export async function phantomSignAndSendSolana(txBase64: string, expectedPublicKey: string): Promise<string> {
  const p = win();
  if (!p?.solana) throw new Error("Phantom isn't installed.");
  if (p.solana.publicKey?.toString() !== expectedPublicKey) {
    const { publicKey } = await p.solana.connect();
    if (publicKey.toString() !== expectedPublicKey)
      throw new Error(`Phantom is on a different account. Switch to ${expectedPublicKey.slice(0, 4)}…${expectedPublicKey.slice(-4)} and retry.`);
  }
  const bytes = Uint8Array.from(atob(txBase64), (c) => c.charCodeAt(0));
  const tx = VersionedTransaction.deserialize(bytes);
  const { signature } = await p.solana.signAndSendTransaction(tx);
  return signature;
}
