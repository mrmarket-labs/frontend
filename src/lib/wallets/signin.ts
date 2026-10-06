import { getEvmWallet } from "./eip6963";
import { phantomEvmProvider } from "./phantom";
import type { Wallet, WalletAddress } from "./types";

export interface SessionInfo {
  address: string;
  kind: "evm" | "solana";
}

interface PhantomSolanaSigner {
  publicKey: { toString(): string } | null;
  connect(): Promise<{ publicKey: { toString(): string } }>;
  signMessage(message: Uint8Array, display?: "utf8" | "hex"): Promise<{ signature: Uint8Array }>;
}

const toBase64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

/** Mirrors the server's buildSignInMessage: the server rebuilds the text, so both must agree. */
function buildMessage(address: string, nonce: string, issuedAt: string): string {
  return [
    "Diversify wants to verify you own this wallet.",
    "",
    "This is a free signature. It does not send a transaction or give Diversify access to your funds.",
    "",
    `Address: ${address}`,
    `Nonce: ${nonce}`,
    `Issued: ${issuedAt}`,
  ].join("\n");
}

/** Pick the address a connected wallet can sign with: Solana for Phantom, otherwise its EVM account. */
export function signableAddress(wallet: Wallet): WalletAddress | null {
  if (wallet.mode !== "connected") return null;
  if (wallet.provider === "phantom") return wallet.addresses.find((a) => a.kind === "solana") ?? wallet.addresses.find((a) => a.kind === "evm") ?? null;
  return wallet.addresses.find((a) => a.kind === "evm") ?? null;
}

export async function getSession(): Promise<SessionInfo | null> {
  const { session } = await api<{ session: SessionInfo | null }>("/api/auth/session");
  return session;
}

export async function signOut(): Promise<void> {
  await fetch("/api/auth/session", { method: "DELETE" });
}

export async function signIn(wallet: Wallet): Promise<SessionInfo> {
  const target = signableAddress(wallet);
  if (!target) throw new Error("Connect a wallet first.");
  const { nonce, issuedAt } = await api<{ nonce: string; issuedAt: string }>("/api/auth/nonce");
  const message = buildMessage(target.address, nonce, issuedAt);

  let signature: string;
  if (target.kind === "solana") {
    const solana = (window as unknown as { phantom?: { solana?: PhantomSolanaSigner } }).phantom?.solana;
    if (!solana) throw new Error("Phantom isn't available in this browser.");
    if (solana.publicKey?.toString() !== target.address) await solana.connect();
    const { signature: bytes } = await solana.signMessage(new TextEncoder().encode(message), "utf8");
    signature = toBase64Url(bytes);
  } else {
    const provider = wallet.provider === "phantom" ? phantomEvmProvider() : getEvmWallet(wallet.provider?.replace("eip6963:", "") ?? "")?.provider;
    if (!provider) throw new Error(`${wallet.label} isn't available in this browser. Reconnect it and retry.`);
    const hex = `0x${toHex(new TextEncoder().encode(message))}`;
    signature = (await provider.request({ method: "personal_sign", params: [hex, target.address] })) as string;
  }

  return api<SessionInfo>("/api/auth/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: target.kind, address: target.address, nonce, issuedAt, signature }),
  });
}
