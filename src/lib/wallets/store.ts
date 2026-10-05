import { detectKind, normalizeAddress, type Wallet } from "./types";

const STORAGE_KEY = "diversify:wallets";
const LEGACY_KEYS = ["diversify:addresses", "holdwise:addresses"];

export function loadWallets(): Wallet[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Wallet[];
    // First run after the upgrade: turn the old pasted-address list into watched wallets.
    for (const key of LEGACY_KEYS) {
      const legacy = localStorage.getItem(key);
      if (!legacy) continue;
      const wallets = legacy
        .split(/[\s,;]+/)
        .map((s) => s.trim())
        .filter((s) => detectKind(s))
        .map((address, i) => watchedWallet(address, `Watched ${i + 1}`));
      saveWallets(wallets);
      return wallets;
    }
  } catch {}
  return [];
}

export function saveWallets(wallets: Wallet[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(wallets));
  } catch {}
}

export function watchedWallet(address: string, label: string): Wallet {
  const kind = detectKind(address)!;
  return {
    id: `watch:${normalizeAddress(address)}`,
    mode: "watched",
    label,
    addresses: [{ kind, address: normalizeAddress(address) }],
  };
}
