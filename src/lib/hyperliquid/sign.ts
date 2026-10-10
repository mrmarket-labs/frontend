/**
 * Signing Hyperliquid exchange actions in the user's own EVM wallet. Hyperliquid is not a chain
 * the wallet sends transactions to: an action is msgpack-encoded, hashed, and the hash is signed
 * as EIP-712 typed data (the "phantom agent" scheme the official SDKs use). Nothing here needs the
 * wallet to be on any particular network.
 */
import { keccak_256 } from "@noble/hashes/sha3.js";
import type { Eip1193Provider } from "../wallets/types";

export const HL_EXCHANGE_URL = "https://api.hyperliquid.xyz/exchange";
export const HL_INFO_URL = "https://api.hyperliquid.xyz/info";

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

/* --- Hashing and signing ---------------------------------------------------------------- */

const toHex = (bytes: Uint8Array) => `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;

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

const EIP712_DOMAIN = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
];
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

async function signTypedData(provider: Eip1193Provider, address: string, typedData: unknown): Promise<Signature> {
  const sig = (await provider.request({ method: "eth_signTypedData_v4", params: [address, JSON.stringify(typedData)] })) as string;
  return splitSignature(sig);
}

/** Sign an L1 action (orders, cancels): the wallet signs the action hash wrapped as an "Agent". */
export async function signL1Action(provider: Eip1193Provider, address: string, action: Packable, nonce: number): Promise<Signature> {
  return signTypedData(provider, address, {
    domain: { name: "Exchange", version: "1", chainId: 1337, verifyingContract: ZERO_ADDRESS },
    types: {
      EIP712Domain: EIP712_DOMAIN,
      Agent: [
        { name: "source", type: "string" },
        { name: "connectionId", type: "bytes32" },
      ],
    },
    primaryType: "Agent",
    message: { source: "a", connectionId: actionHash(action, nonce) },
  });
}

/**
 * Sign a user-signed action (builder-fee approval): the fields themselves are the typed message.
 * Any chain id works as long as the domain and `signatureChainId` agree; the wallet's current one
 * avoids a network switch.
 */
export async function signApproveBuilderFee(
  provider: Eip1193Provider,
  address: string,
  builder: string,
  maxFeeRate: string,
  nonce: number,
): Promise<{ action: Record<string, Packable>; signature: Signature }> {
  const chainIdHex = (await provider.request({ method: "eth_chainId" })) as string;
  const chainId = parseInt(chainIdHex, 16);
  const action = {
    type: "approveBuilderFee",
    hyperliquidChain: "Mainnet",
    signatureChainId: `0x${chainId.toString(16)}`,
    maxFeeRate,
    builder: builder.toLowerCase(),
    nonce,
  };
  const signature = await signTypedData(provider, address, {
    domain: { name: "HyperliquidSignTransaction", version: "1", chainId, verifyingContract: ZERO_ADDRESS },
    types: {
      EIP712Domain: EIP712_DOMAIN,
      "HyperliquidTransaction:ApproveBuilderFee": [
        { name: "hyperliquidChain", type: "string" },
        { name: "maxFeeRate", type: "string" },
        { name: "builder", type: "address" },
        { name: "nonce", type: "uint64" },
      ],
    },
    primaryType: "HyperliquidTransaction:ApproveBuilderFee",
    message: { hyperliquidChain: "Mainnet", maxFeeRate, builder: builder.toLowerCase(), nonce },
  });
  return { action, signature };
}

/* --- Exchange calls -------------------------------------------------------------------- */

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

/** Place one immediate-or-cancel order and return its status. */
export async function placeOrder(
  provider: Eip1193Provider,
  address: string,
  order: OrderWire,
  builder: { b: string; f: number } | null,
): Promise<OrderStatus> {
  // Key order matters: the hash is over the msgpack bytes, and the server packs in this order.
  const action: Record<string, Packable> = { type: "order", orders: [order as unknown as Packable], grouping: "na" };
  if (builder) action.builder = { b: builder.b.toLowerCase(), f: builder.f };
  const nonce = Date.now();
  const signature = await signL1Action(provider, address, action, nonce);
  const data = await postExchange({ action, nonce, signature, vaultAddress: null });
  const status = typeof data.response === "object" ? data.response?.data?.statuses[0] : undefined;
  if (!status) throw new Error("Hyperliquid returned no order status");
  return status;
}

export async function approveBuilderFee(provider: Eip1193Provider, address: string, builder: string, maxFeeRate: string): Promise<void> {
  const nonce = Date.now();
  const { action, signature } = await signApproveBuilderFee(provider, address, builder, maxFeeRate, nonce);
  await postExchange({ action, nonce, signature });
}

/** The on-exchange hash of the fill for an order, once it shows in the user's fills. */
export async function fillHash(address: string, oid: number): Promise<string | null> {
  for (let i = 0; i < 5; i++) {
    const res = await fetch(HL_INFO_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "userFills", user: address }),
    }).catch(() => null);
    const fills = res && res.ok ? ((await res.json()) as { oid: number; hash: string }[]) : [];
    const fill = fills.find((f) => f.oid === oid);
    if (fill?.hash) return fill.hash;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}
