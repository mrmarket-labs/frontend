import type { Eip1193Provider } from "./types";

export interface EvmWalletInfo {
  rdns: string;
  name: string;
  icon: string;
  provider: Eip1193Provider;
}

interface AnnounceEvent extends Event {
  detail: { info: { rdns: string; name: string; icon: string }; provider: Eip1193Provider };
}

const wallets = new Map<string, EvmWalletInfo>();
const listeners = new Set<() => void>();
let started = false;

/** EIP-6963: wallets announce themselves, so MetaMask, Rabby, Coinbase Wallet etc. all show up without SDKs. */
function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("eip6963:announceProvider", (e) => {
    const { info, provider } = (e as AnnounceEvent).detail;
    // Phantom is handled as a multi-chain wallet elsewhere.
    if (info.rdns === "app.phantom") return;
    wallets.set(info.rdns, { ...info, provider });
    listeners.forEach((l) => l());
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

export function subscribeEvmWallets(listener: () => void): () => void {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getEvmWallets(): EvmWalletInfo[] {
  start();
  return [...wallets.values()];
}

export function getEvmWallet(rdns: string): EvmWalletInfo | undefined {
  return wallets.get(rdns);
}
