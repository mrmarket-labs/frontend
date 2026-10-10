import { AppError } from "../i18n";
import type { Holding } from "../types";
import { getWallet } from "./registry";
import { sameAddress, type Wallet, type WalletAddress } from "./types";

export interface SessionInfo {
  address: string;
  kind: "evm" | "solana";
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
    "Invest Like Buffett wants to verify you own this wallet.",
    "",
    "This is a free signature. It does not send a transaction or give Invest Like Buffett access to your funds.",
    "",
    `Address: ${address}`,
    `Nonce: ${nonce}`,
    `Issued: ${issuedAt}`,
  ].join("\n");
}

/**
 * Pick the address a connected wallet signs in with. The server only accepts a signer that holds
 * funds, so prefer the account the scanned money is in: a MetaMask with an empty Solana account
 * and a funded Ethereum one must sign with the latter. Solana first on a tie or with no scan.
 */
export function signableAddress(wallet: Wallet, holdings: Holding[] = []): WalletAddress | null {
  if (wallet.mode !== "connected") return null;
  const candidates = wallet.addresses.filter((a) => a.kind === "solana" || a.kind === "evm");
  const valueOf = (a: WalletAddress) => holdings.filter((h) => sameAddress(h.address, a.address)).reduce((s, h) => s + h.valueUsd, 0);
  return [...candidates].sort((a, b) => valueOf(b) - valueOf(a) || (a.kind === "solana" ? -1 : 1))[0] ?? null;
}

export async function getSession(): Promise<SessionInfo | null> {
  const { session } = await api<{ session: SessionInfo | null }>("/api/auth/session");
  return session;
}

export async function signOut(): Promise<void> {
  await fetch("/api/auth/session", { method: "DELETE" });
}

export async function signIn(wallet: Wallet, holdings: Holding[] = []): Promise<SessionInfo> {
  const target = signableAddress(wallet, holdings);
  if (!target) throw new AppError("connectFirst");
  const { nonce, issuedAt } = await api<{ nonce: string; issuedAt: string }>("/api/auth/nonce");
  const message = buildMessage(target.address, nonce, issuedAt);

  const installed = getWallet(wallet.provider);
  const unavailable = () => new AppError("unavailable", { name: wallet.label });
  let signature: string;
  if (target.kind === "solana") {
    if (!installed?.solana) throw unavailable();
    signature = toBase64Url(await installed.solana.signMessage(new TextEncoder().encode(message), target.address));
  } else {
    if (!installed?.evm) throw unavailable();
    const hex = `0x${toHex(new TextEncoder().encode(message))}`;
    signature = (await installed.evm.provider.request({ method: "personal_sign", params: [hex, target.address] })) as string;
  }

  return api<SessionInfo>("/api/auth/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: target.kind, address: target.address, nonce, issuedAt, signature }),
  });
}
