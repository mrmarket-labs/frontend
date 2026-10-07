import { ed25519 } from "@noble/curves/ed25519.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { PublicKey } from "@solana/web3.js";
import { setIfAbsent } from "./limits";

export type SessionKind = "evm" | "solana";

export interface Session {
  address: string;
  kind: SessionKind;
  /** Unix seconds. */
  exp: number;
}

const COOKIE = "dv_session";
const SESSION_DAYS = 30;
const NONCE_TTL_SEC = 300;
const DEV_SECRET = "dev-only-secret-change-me";
const SECRET = process.env.AUTH_SECRET || (process.env.NODE_ENV === "production" ? "" : DEV_SECRET);

export const authConfigured = Boolean(SECRET);

const enc = new TextEncoder();
const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const fromB64url = (s: string) => new Uint8Array(Buffer.from(s, "base64url"));

async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data))));
}

/** Opaque, tamper-evident token carrying `payload` (e.g. an unsubscribe link). */
export async function signToken(payload: string): Promise<string> {
  const body = b64url(enc.encode(payload));
  return `${body}.${await hmac(`token|${body}`)}`;
}

export async function verifyToken(token: string): Promise<string | null> {
  const [body, sig] = token.split(".");
  if (!body || !sig || (await hmac(`token|${body}`)) !== sig) return null;
  return new TextDecoder().decode(fromB64url(body));
}

/** The exact text the wallet signs. Rebuilt server-side so nothing else can be smuggled in. */
export function buildSignInMessage(address: string, nonce: string, issuedAt: string): string {
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

/**
 * Nonces are self-verifying (HMAC over random bytes + issue time) so any serverless instance can
 * check one without shared state. With Redis available they are additionally single-use.
 */
export async function issueNonce(): Promise<{ nonce: string; issuedAt: string }> {
  const issuedAt = new Date().toISOString();
  const rand = crypto.randomUUID().replace(/-/g, "");
  return { nonce: `${rand}.${await hmac(`nonce|${rand}|${issuedAt}`)}`, issuedAt };
}

export async function consumeNonce(nonce: string, issuedAt: string): Promise<boolean> {
  const [rand, sig] = nonce.split(".");
  if (!/^[0-9a-f]{32}$/.test(rand ?? "") || !sig) return false;
  if (Math.abs(Date.now() - Date.parse(issuedAt)) > NONCE_TTL_SEC * 1000) return false;
  if ((await hmac(`nonce|${rand}|${issuedAt}`)) !== sig) return false;
  return setIfAbsent(`nonce:used:${rand}`, NONCE_TTL_SEC);
}

function verifyEvm(address: string, message: string, signatureHex: string): boolean {
  const sig = Buffer.from(signatureHex.replace(/^0x/, ""), "hex");
  if (sig.length !== 65) return false;
  const body = enc.encode(message);
  const prefixed = Buffer.concat([enc.encode(`\x19Ethereum Signed Message:\n${body.length}`), body]);
  const hash = keccak_256(prefixed);
  let v = sig[64];
  if (v >= 27) v -= 27;
  if (v > 3) return false;
  try {
    const pub = secp256k1.Signature.fromBytes(sig.subarray(0, 64), "compact").addRecoveryBit(v).recoverPublicKey(hash).toBytes(false);
    const recovered = `0x${Buffer.from(keccak_256(pub.subarray(1)).slice(-20)).toString("hex")}`;
    return recovered === address.toLowerCase();
  } catch {
    return false;
  }
}

function verifySolana(address: string, message: string, signatureB64: string): boolean {
  try {
    return ed25519.verify(fromB64url(signatureB64), enc.encode(message), new PublicKey(address).toBytes());
  } catch {
    return false;
  }
}

export function verifySignature(kind: SessionKind, address: string, message: string, signature: string): boolean {
  return kind === "evm" ? verifyEvm(address, message, signature) : verifySolana(address, message, signature);
}

export async function sessionCookie(session: Session): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify(session)));
  const value = `${payload}.${await hmac(payload)}`;
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function newSession(address: string, kind: SessionKind): Session {
  return { address: kind === "evm" ? address.toLowerCase() : address, kind, exp: Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400 };
}

export async function readSession(request: Request): Promise<Session | null> {
  if (!authConfigured) return null;
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!match) return null;
  const [payload, sig] = match[1].split(".");
  if (!payload || !sig || (await hmac(payload)) !== sig) return null;
  try {
    const session = JSON.parse(Buffer.from(fromB64url(payload)).toString()) as Session;
    return session.exp > Date.now() / 1000 ? session : null;
  } catch {
    return null;
  }
}
