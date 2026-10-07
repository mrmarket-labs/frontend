import { getWallet } from "./registry";
import type { Wallet, WalletAddress } from "./types";

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
    "Diversify wants to verify you own this wallet.",
    "",
    "This is a free signature. It does not send a transaction or give Diversify access to your funds.",
    "",
    `Address: ${address}`,
    `Nonce: ${nonce}`,
    `Issued: ${issuedAt}`,
  ].join("\n");
}

/** Pick the address a connected wallet can sign with: its Solana account if it has one, otherwise EVM. */
export function signableAddress(wallet: Wallet): WalletAddress | null {
  if (wallet.mode !== "connected") return null;
  return wallet.addresses.find((a) => a.kind === "solana") ?? wallet.addresses.find((a) => a.kind === "evm") ?? null;
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

  const installed = getWallet(wallet.provider);
  const unavailable = () => new Error(`${wallet.label} isn't available in this browser. Reconnect it and retry.`);
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
