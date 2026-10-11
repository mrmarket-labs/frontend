/**
 * Signing Hyperliquid exchange actions. Hyperliquid is not a chain the wallet sends transactions
 * to: an action is msgpack-encoded, hashed, and the hash is signed as EIP-712 typed data under a
 * fixed dummy chain id (1337). Wallets such as MetaMask refuse typed data whose chain id is not the
 * active network, so orders are not signed by the wallet at all. Instead, as on Hyperliquid's own
 * site, the wallet approves once a browser-local "API wallet" (agent) under its current chain id,
 * and that key signs every order locally, with no prompt. An agent can trade; it can never withdraw.
 */
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import type { Eip1193Provider } from "../wallets/types";

export const HL_EXCHANGE_URL = "https://api.hyperliquid.xyz/exchange";
export const HL_INFO_URL = "https://api.hyperliquid.xyz/info";
/** Name the approved API wallet carries on Hyperliquid (at most 16 characters), so the user can recognise and revoke it. */
export const AGENT_NAME = "investbuffett";

type Packable = null | boolean | number | string | Packable[] | { [key: string]: Packable };

/* --- msgpack, the subset Hyperliquid actions use --------------------------------------- */

function packInto(out: number[], value: Packable): void {
  if (value === null) return void out.push(0xc0);
  if (value === true) return void out.push(0xc3);
  if (value === false) return void out.push(0xc2);
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0) throw new Error(`Cannot pack ${value}`);
    if (value < 0x80) return void out.push(value);
    if (value < 0x100) return void out.push(0xcc, value);
    if (value < 0x10000) return void out.push(0xcd, value >> 8, value & 0xff);
    if (value < 0x1_0000_0000) return void out.push(0xce, (value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
    const big = BigInt(value);
    out.push(0xcf);
    for (let i = 7; i >= 0; i--) out.push(Number((big >> BigInt(i * 8)) & BigInt(0xff)));
    return;
  }
  if (typeof value === "string") {
    const bytes = new TextEncoder().encode(value);
    if (bytes.length < 32) out.push(0xa0 | bytes.length);
    else if (bytes.length < 0x100) out.push(0xd9, bytes.length);
    else out.push(0xda, bytes.length >> 8, bytes.length & 0xff);
    for (const b of bytes) out.push(b);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length < 16) out.push(0x90 | value.length);
    else out.push(0xdc, value.length >> 8, value.length & 0xff);
    for (const v of value) packInto(out, v);
    return;
  }
  const keys = Object.keys(value);
  if (keys.length < 16) out.push(0x80 | keys.length);
  else out.push(0xde, keys.length >> 8, keys.length & 0xff);
  for (const k of keys) {
    packInto(out, k);
    packInto(out, value[k]);
  }
}

export function msgpack(value: Packable): Uint8Array {
  const out: number[] = [];
  packInto(out, value);
  return Uint8Array.from(out);
}

/* --- Bytes and hashing -------------------------------------------------------------------- */

const toHex = (bytes: Uint8Array) => `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
const fromHex = (hex: string) => Uint8Array.from(hex.replace(/^0x/, "").match(/../g) ?? [], (x) => parseInt(x, 16));
const utf8 = (s: string) => new TextEncoder().encode(s);
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
const u256 = (n: bigint) => fromHex(n.toString(16).padStart(64, "0"));

/** keccak(msgpack(action) ‖ nonce as 8 big-endian bytes ‖ 0x00 for "no vault"). */
export function actionHash(action: Packable, nonce: number): string {
  const packed = msgpack(action);
  const bytes = new Uint8Array(packed.length + 9);
  bytes.set(packed);
  let n = BigInt(nonce);
  for (let i = 7; i >= 0; i--) {
    bytes[packed.length + i] = Number(n & BigInt(0xff));
    n >>= BigInt(8);
  }
  bytes[packed.length + 8] = 0;
  return toHex(keccak_256(bytes));
}

/* --- EIP-712, the field types Hyperliquid's messages use ---------------------------------- */

interface Field {
  name: string;
  type: string;
}

const EIP712_DOMAIN: Field[] = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
];
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function encodeField(type: string, value: unknown): Uint8Array {
  if (type === "string") return keccak_256(utf8(String(value)));
  if (type === "bytes32") return fromHex(String(value));
  if (type === "address") return u256(BigInt(String(value)));
  if (type.startsWith("uint")) return u256(BigInt(value as number));
  throw new Error(`Unsupported EIP-712 type ${type}`);
}

function structHash(name: string, fields: Field[], data: Record<string, unknown>): Uint8Array {
  const typeHash = keccak_256(utf8(`${name}(${fields.map((f) => `${f.type} ${f.name}`).join(",")})`));
  return keccak_256(concat(typeHash, ...fields.map((f) => encodeField(f.type, data[f.name]))));
}

function typedDataDigest(domain: Record<string, unknown>, primaryType: string, fields: Field[], message: Record<string, unknown>): Uint8Array {
  return keccak_256(concat(Uint8Array.from([0x19, 0x01]), structHash("EIP712Domain", EIP712_DOMAIN, domain), structHash(primaryType, fields, message)));
}

export interface Signature {
  r: string;
  s: string;
  v: number;
}

function splitSignature(sig: string): Signature {
  const hex = sig.replace(/^0x/, "");
  if (hex.length !== 130) throw new Error("Unexpected signature length");
  let v = parseInt(hex.slice(128), 16);
  if (v < 27) v += 27;
  return { r: `0x${hex.slice(0, 64)}`, s: `0x${hex.slice(64, 128)}`, v };
}

/* --- The agent: a key this browser holds for this user ------------------------------------ */

export interface Agent {
  key: Uint8Array;
  address: string;
}

const agentStorageKey = (user: string) => `diversify:hl-agent:${user.toLowerCase()}`;

const addressOf = (key: Uint8Array) => `0x${toHex(keccak_256(secp256k1.getPublicKey(key, false).subarray(1))).slice(-40)}`;

/** The user's agent key in this browser, made on first use. */
export function loadOrCreateAgent(user: string): Agent {
  let hex: string | null = null;
  try {
    hex = localStorage.getItem(agentStorageKey(user));
  } catch {}
  let key = hex ? fromHex(hex) : null;
  if (!key || key.length !== 32) {
    key = secp256k1.utils.randomSecretKey();
    try {
      localStorage.setItem(agentStorageKey(user), toHex(key));
    } catch {}
  }
  return { key, address: addressOf(key) };
}

export async function info<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch(HL_INFO_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Hyperliquid responded ${res.status}`);
  return res.json() as Promise<T>;
}

/** Whether Hyperliquid currently lists this agent for the user. */
export async function agentIsApproved(user: string, agentAddress: string): Promise<boolean> {
  const agents = await info<{ address: string }[]>({ type: "extraAgents", user }).catch(() => [] as { address: string }[]);
  return agents.some((a) => a.address.toLowerCase() === agentAddress.toLowerCase());
}

/** The agent signs an L1 action (orders, cancels) locally: the action hash wrapped as an "Agent" struct. */
export function signL1ActionWithAgent(agent: Agent, action: Packable, nonce: number): Signature {
  const digest = typedDataDigest(
    { name: "Exchange", version: "1", chainId: 1337, verifyingContract: ZERO_ADDRESS },
    "Agent",
    [
      { name: "source", type: "string" },
      { name: "connectionId", type: "bytes32" },
    ],
    { source: "a", connectionId: actionHash(action, nonce) },
  );
  const sig = secp256k1.sign(digest, agent.key, { prehash: false, format: "recovered" });
  return { r: toHex(sig.subarray(1, 33)), s: toHex(sig.subarray(33, 65)), v: sig[0] + 27 };
}

/* --- User-signed actions: the wallet signs, under its own active chain id ----------------- */

/**
 * The fields themselves are the typed message. Any chain id is accepted by Hyperliquid as long as
 * the domain and `signatureChainId` agree, and the wallet's active one is the only one wallets
 * will sign under without a network switch.
 */
async function signUserAction(
  provider: Eip1193Provider,
  address: string,
  type: string,
  primaryType: string,
  fields: Field[],
  message: Record<string, string | number>,
): Promise<{ action: Record<string, Packable>; signature: Signature }> {
  const chainId = parseInt((await provider.request({ method: "eth_chainId" })) as string, 16);
  const nonce = Date.now();
  const full = { hyperliquidChain: "Mainnet", ...message, nonce };
  const typedData = {
    domain: { name: "HyperliquidSignTransaction", version: "1", chainId, verifyingContract: ZERO_ADDRESS },
    types: { EIP712Domain: EIP712_DOMAIN, [primaryType]: fields },
    primaryType,
    message: full,
  };
  const sig = (await provider.request({ method: "eth_signTypedData_v4", params: [address, JSON.stringify(typedData)] })) as string;
  return { action: { type, signatureChainId: `0x${chainId.toString(16)}`, ...full }, signature: splitSignature(sig) };
}

interface ExchangeResponse {
  status: "ok" | "err";
  response?: { type: string; data?: { statuses: OrderStatus[] } } | string;
}

async function postExchange(payload: unknown): Promise<ExchangeResponse> {
  const res = await fetch(HL_EXCHANGE_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json().catch(() => null)) as ExchangeResponse | null;
  if (!res.ok || !data) throw new Error(`Hyperliquid responded ${res.status}`);
  if (data.status !== "ok") throw new Error(typeof data.response === "string" ? data.response : "Hyperliquid rejected the request");
  return data;
}

/** Let this browser's agent place orders for the user. One wallet signature. */
export async function approveAgent(provider: Eip1193Provider, user: string, agent: Agent): Promise<void> {
  const { action, signature } = await signUserAction(
    provider,
    user,
    "approveAgent",
    "HyperliquidTransaction:ApproveAgent",
    [
      { name: "hyperliquidChain", type: "string" },
      { name: "agentAddress", type: "address" },
      { name: "agentName", type: "string" },
      { name: "nonce", type: "uint64" },
    ],
    { agentAddress: agent.address, agentName: AGENT_NAME },
  );
  await postExchange({ action, nonce: action.nonce, signature });
}

/** Let the app's fee be taken out of the user's orders, up to `maxFeeRate` (e.g. "0.5%"). One wallet signature. */
export async function approveBuilderFee(provider: Eip1193Provider, user: string, builder: string, maxFeeRate: string): Promise<void> {
  const { action, signature } = await signUserAction(
    provider,
    user,
    "approveBuilderFee",
    "HyperliquidTransaction:ApproveBuilderFee",
    [
      { name: "hyperliquidChain", type: "string" },
      { name: "maxFeeRate", type: "string" },
      { name: "builder", type: "address" },
      { name: "nonce", type: "uint64" },
    ],
    { maxFeeRate, builder: builder.toLowerCase() },
  );
  await postExchange({ action, nonce: action.nonce, signature });
}

/* --- Orders -------------------------------------------------------------------------------- */

export interface OrderWire {
  a: number;
  b: boolean;
  p: string;
  s: string;
  r: boolean;
  t: { limit: { tif: "Ioc" } };
}

export interface OrderStatus {
  filled?: { totalSz: string; avgPx: string; oid: number };
  resting?: { oid: number };
  error?: string;
}

/** Place one immediate-or-cancel order, signed by the agent, and return its status. */
export async function placeOrder(agent: Agent, order: OrderWire, builder: { b: string; f: number } | null): Promise<OrderStatus> {
  // Key order matters: the hash is over the msgpack bytes, and the server packs in this order.
  const action: Record<string, Packable> = { type: "order", orders: [order as unknown as Packable], grouping: "na" };
  if (builder) action.builder = { b: builder.b.toLowerCase(), f: builder.f };
  const nonce = Date.now();
  const signature = signL1ActionWithAgent(agent, action, nonce);
  const data = await postExchange({ action, nonce, signature, vaultAddress: null });
  const status = typeof data.response === "object" ? data.response?.data?.statuses[0] : undefined;
  if (!status) throw new Error("Hyperliquid returned no order status");
  return status;
}

/** The on-exchange hash of the fill for an order, once it shows in the user's fills. */
export async function fillHash(user: string, oid: number): Promise<string | null> {
  for (let i = 0; i < 5; i++) {
    const fills = await info<{ oid: number; hash: string }[]>({ type: "userFills", user }).catch(() => [] as { oid: number; hash: string }[]);
    const fill = fills.find((f) => f.oid === oid);
    if (fill?.hash) return fill.hash;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}
