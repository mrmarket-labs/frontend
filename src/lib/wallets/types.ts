export type AddressKind = "solana" | "evm" | "bitcoin";

export interface WalletAddress {
  kind: AddressKind;
  address: string;
  /** e.g. "payment" or "ordinals" for Bitcoin accounts. */
  note?: string;
}

export interface Wallet {
  id: string;
  mode: "connected" | "watched";
  /** "phantom" or "eip6963:<rdns>" for connected wallets. */
  provider?: string;
  label: string;
  addresses: WalletAddress[];
}

export function detectKind(address: string): AddressKind | null {
  if (/^0x[0-9a-fA-F]{40}$/.test(address)) return "evm";
  if (/^[xyz]pub[1-9A-HJ-NP-Za-km-z]{100,112}$/.test(address)) return "bitcoin";
  const lower = /^bc1/i.test(address) ? address.toLowerCase() : address;
  if (/^(bc1[02-9ac-hj-np-z]{11,87}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/.test(lower)) return "bitcoin";
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return "solana";
  return null;
}

export function normalizeAddress(address: string): string {
  const kind = detectKind(address);
  if (kind === "evm") return address.toLowerCase();
  if (kind === "bitcoin" && /^bc1/i.test(address)) return address.toLowerCase();
  return address;
}

export function sameAddress(a: string, b: string): boolean {
  return normalizeAddress(a) === normalizeAddress(b);
}

export function shortAddress(address: string): string {
  return address.length > 16 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}
