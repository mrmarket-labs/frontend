import type { HyperliquidLeg } from "@/app/api/swap/hyperliquid/route";
import { approveBuilderFee, fillHash, placeOrder, type OrderStatus } from "../hyperliquid/sign";
import { floatToWire, roundSize } from "../hyperliquid/spot";
import { AppError } from "../i18n";
import type { SwapStep } from "../plan";
import { EVM_CHAIN_IDS, EVM_CHAIN_PARAMS, NATIVE, ZEROX_NATIVE, fromRawUnits, toRawUnits, type EvmExecChain } from "../tokens";
import { getWallet } from "./registry";
import type { Eip1193Provider, Wallet } from "./types";

export interface SolanaQuote {
  kind: "solana";
  inAmount: string;
  outAmount: string;
  minOutAmount: string;
  priceImpactPct: number;
  feeBps: number;
  feeAmount: string;
  feeMint: string | null;
  route: string[];
  networkFeeLamports: number;
  swapTransaction: string;
  lastValidBlockHeight: number;
}

export interface EvmQuote {
  kind: "evm";
  sellAmount: string;
  buyAmount: string;
  minBuyAmount: string;
  feeBps: number;
  feeAmount: string;
  route: string[];
  allowance: { spender: string; actual: string } | null;
  transaction: { to: string; data: string; value: string; gas: string | null; gasPrice: string };
}

export interface HyperliquidQuote {
  kind: "hyperliquid";
  legs: HyperliquidLeg[];
  receive: number;
  minReceive: number;
  priceImpactPct: number;
  feeBps: number;
  feeUsd: number;
  route: string[];
  builder: { address: string; feeTenthsBp: number; maxFeeRate: string; approved: boolean } | null;
}

export type Quote = SolanaQuote | EvmQuote | HyperliquidQuote;
export type Phase = "approving" | "signing" | "confirming";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export function sellAmountRaw(step: SwapStep): string {
  return toRawUnits(step.sell.amount, step.sell.token.decimals);
}

export async function fetchQuote(step: SwapStep): Promise<Quote> {
  if (step.chain === "hyperliquid") {
    const q = await api<Omit<HyperliquidQuote, "kind">>("/api/swap/hyperliquid", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sellToken: step.sell.token.address, buyToken: step.buy.token.address, amount: step.sell.amount, user: step.address }),
    });
    return { kind: "hyperliquid", ...q };
  }
  if (step.chain === "solana") {
    const q = await api<Omit<SolanaQuote, "kind">>("/api/swap/solana", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        inputMint: step.sell.token.address,
        outputMint: step.buy.token.address,
        amount: sellAmountRaw(step),
        userPublicKey: step.address,
      }),
    });
    return { kind: "solana", ...q };
  }
  const evm = (a: string) => (a === NATIVE ? ZEROX_NATIVE : a);
  const params = new URLSearchParams({
    chainId: String(EVM_CHAIN_IDS[step.chain]),
    sellToken: evm(step.sell.token.address),
    buyToken: evm(step.buy.token.address),
    sellAmount: sellAmountRaw(step),
    taker: step.address,
  });
  const q = await api<Omit<EvmQuote, "kind">>(`/api/swap/evm?${params}`);
  return { kind: "evm", ...q };
}

/** Human-readable numbers for the review sheet. */
export function describeQuote(step: SwapStep, quote: Quote) {
  if (quote.kind === "hyperliquid")
    return {
      // A sell is sized to the token's lot size; what is paid is that size, not the plan's fraction.
      pay: quote.legs[0].isBuy ? step.sell.amount : quote.legs[0].size,
      receive: quote.receive,
      minReceive: quote.minReceive,
      feeBps: quote.feeBps,
      feeUsd: quote.feeUsd,
      priceImpactPct: quote.priceImpactPct,
      networkFeeUsd: null,
      route: quote.route,
      // A one-time signature lets the exchange pay the app's fee out of the order.
      needsApproval: quote.builder != null && !quote.builder.approved,
    };
  const out = fromRawUnits(quote.kind === "solana" ? quote.outAmount : quote.buyAmount, step.buy.token.decimals);
  const minOut = fromRawUnits(quote.kind === "solana" ? quote.minOutAmount : quote.minBuyAmount, step.buy.token.decimals);
  const sellPrice = step.sell.usd / step.sell.amount;
  const buyPrice = out > 0 ? step.buy.usd / out : 0;
  // Fee is taken in the sell token (EVM, or Solana input-mint fee) or the buy token (Solana output-mint fee).
  const feeInBuyToken = quote.kind === "solana" && quote.feeMint === step.buy.token.address;
  const feeAmount = fromRawUnits(quote.feeAmount, feeInBuyToken ? step.buy.token.decimals : step.sell.token.decimals);
  return {
    pay: step.sell.amount,
    receive: out,
    minReceive: minOut,
    feeBps: quote.feeBps,
    feeUsd: feeAmount * (feeInBuyToken ? buyPrice : sellPrice),
    priceImpactPct: quote.kind === "solana" ? quote.priceImpactPct : null,
    networkFeeUsd: quote.kind === "solana" ? (quote.networkFeeLamports / 1e9) * sellPriceIfSol(step, sellPrice) : null,
    route: quote.route,
    needsApproval: quote.kind === "evm" && quote.allowance != null && BigInt(quote.allowance.actual) < BigInt(quote.sellAmount),
  };
}

function sellPriceIfSol(step: SwapStep, sellPrice: number): number {
  return step.sell.symbol === "SOL" ? sellPrice : 0;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Broadcast, then keep rebroadcasting the same signed bytes until the chain confirms or the blockhash expires. */
async function sendAndConfirmSolana(signedTransaction: string, lastValidBlockHeight: number, onSent: (sig: string) => void): Promise<string> {
  const { signature } = await api<{ signature: string }>("/api/swap/solana/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ signedTransaction }),
  });
  onSent(signature);
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    await sleep(2000);
    const s = await api<{ status: "pending" | "confirmed" | "failed" | "expired"; error?: string }>(
      `/api/swap/solana/status?signature=${signature}&lastValidBlockHeight=${lastValidBlockHeight}`,
    );
    if (s.status === "confirmed") return signature;
    if (s.status === "failed") throw new AppError("txFailed", { error: s.error ?? "unknown error" });
    if (s.status === "expired") throw new AppError("txExpired");
    // Not landed yet: resend the identical bytes (same signature) so it reaches a leader.
    await fetch("/api/swap/solana/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signedTransaction }),
    }).catch(() => undefined);
  }
  throw new AppError("txUnconfirmedSolana");
}

function evmProviderFor(wallet: Wallet): Eip1193Provider {
  const p = getWallet(wallet.provider)?.evm?.provider;
  if (!p) throw new AppError("unavailable", { name: wallet.label });
  return p;
}

const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

async function ensureEvmAccount(provider: Eip1193Provider, address: string): Promise<void> {
  const has = (accounts: string[]) => accounts.some((a) => a.toLowerCase() === address.toLowerCase());
  if (has((await provider.request({ method: "eth_accounts" })) as string[])) return;
  if (has((await provider.request({ method: "eth_requestAccounts" })) as string[])) return;
  throw new AppError("switchAccount", { address: `${address.slice(0, 6)}…${address.slice(-4)}` });
}

async function ensureEvmChain(provider: Eip1193Provider, chain: EvmExecChain): Promise<void> {
  const chainId = `0x${EVM_CHAIN_IDS[chain].toString(16)}`;
  if ((await provider.request({ method: "eth_chainId" })) === chainId) return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  } catch (e) {
    if ((e as { code?: number }).code !== 4902) throw new AppError("switchChain", { chain: EVM_CHAIN_PARAMS[chain].chainName });
    await provider.request({ method: "wallet_addEthereumChain", params: [{ chainId, ...EVM_CHAIN_PARAMS[chain] }] });
  }
}

async function waitEvmReceipt(provider: Eip1193Provider, hash: string): Promise<void> {
  for (let i = 0; i < 60; i++) {
    const receipt = (await provider.request({ method: "eth_getTransactionReceipt", params: [hash] })) as { status: string } | null;
    if (receipt) {
      if (receipt.status === "0x1") return;
      throw new AppError("txReverted");
    }
    await sleep(3000);
  }
  throw new AppError("txUnconfirmedEvm");
}

const pad = (hex: string) => hex.replace(/^0x/, "").padStart(64, "0");
/** ERC-20 approve(spender, amount) for exactly the amount being sold: no unlimited approvals. */
function approveData(spender: string, amount: string): string {
  return `0x095ea7b3${pad(spender)}${pad(BigInt(amount).toString(16))}`;
}

/**
 * Hyperliquid: one immediate-or-cancel order per leg, each signed in the wallet. Nothing is
 * broadcast on a chain; the exchange answers at once with what filled.
 */
async function executeHyperliquid(step: SwapStep, wallet: Wallet, quote: HyperliquidQuote, onPhase: (p: Phase) => void): Promise<string> {
  const provider = evmProviderFor(wallet);
  await ensureEvmAccount(provider, step.address);
  // Books move; price the orders off the book as it is right before signing.
  const fresh = (await fetchQuote(step)) as HyperliquidQuote;
  if (fresh.minReceive < quote.minReceive * 0.99) throw new AppError("priceMoved");

  if (fresh.builder && !fresh.builder.approved) {
    onPhase("approving");
    await approveBuilderFee(provider, step.address, fresh.builder.address, fresh.builder.maxFeeRate);
  }
  const builder = fresh.builder ? { b: fresh.builder.address, f: fresh.builder.feeTenthsBp } : null;
  const feeRate = fresh.builder ? fresh.builder.feeTenthsBp / 100_000 : 0;

  let usdcFromPrevious: number | null = null;
  let last: OrderStatus["filled"] | undefined;
  for (const leg of fresh.legs) {
    // The second leg spends what the first actually brought in, net of the exchange's and the app's fees.
    const size = usdcFromPrevious == null ? leg.size : roundSize((usdcFromPrevious * (1 - 0.0007 - feeRate)) / Number(leg.limitPx), leg.szDecimals);
    if (size <= 0) throw new AppError("orderRejected", { error: "nothing left to buy after the first leg" });
    onPhase("signing");
    const status = await placeOrder(provider, step.address, { a: leg.asset, b: leg.isBuy, p: leg.limitPx, s: floatToWire(size), r: false, t: { limit: { tif: "Ioc" } } }, builder);
    if (status.error) throw new AppError("orderRejected", { error: status.error });
    if (!status.filled) throw new AppError("orderRejected", { error: "the order did not fill" });
    last = status.filled;
    usdcFromPrevious = leg.isBuy ? null : Number(status.filled.totalSz) * Number(status.filled.avgPx);
  }
  onPhase("confirming");
  return (await fillHash(step.address, last!.oid)) ?? String(last!.oid);
}

export async function executeStep(
  step: SwapStep,
  wallet: Wallet,
  quote: Quote,
  onPhase: (p: Phase) => void,
  onSent: (txId: string) => void = () => undefined,
): Promise<string> {
  if (quote.kind === "hyperliquid") return executeHyperliquid(step, wallet, quote, onPhase);
  if (quote.kind === "solana") {
    const solana = getWallet(wallet.provider)?.solana;
    if (!solana) throw new AppError("unavailable", { name: wallet.label });
    // Blockhashes live ~60s, so build the transaction right before the wallet opens.
    const fresh = (await fetchQuote(step)) as SolanaQuote;
    if (BigInt(fresh.minOutAmount) < (BigInt(quote.minOutAmount) * BigInt(99)) / BigInt(100))
      throw new AppError("priceMoved");
    onPhase("signing");
    // Sign only; the app broadcasts and rebroadcasts the bytes itself so the swap can't be dropped silently.
    const signed = toBase64(await solana.signTransaction(fromBase64(fresh.swapTransaction), step.address));
    onPhase("confirming");
    return sendAndConfirmSolana(signed, fresh.lastValidBlockHeight, onSent);
  }

  const provider = evmProviderFor(wallet);
  await ensureEvmAccount(provider, step.address);
  await ensureEvmChain(provider, step.chain as EvmExecChain);

  let live = quote;
  if (live.allowance && BigInt(live.allowance.actual) < BigInt(live.sellAmount)) {
    onPhase("approving");
    const hash = (await provider.request({
      method: "eth_sendTransaction",
      params: [{ from: step.address, to: step.sell.token.address, data: approveData(live.allowance.spender, live.sellAmount) }],
    })) as string;
    await waitEvmReceipt(provider, hash);
    // The approval took time; get fresh pricing before the real swap.
    live = (await fetchQuote(step)) as EvmQuote;
  }

  onPhase("signing");
  const tx = live.transaction;
  const hash = (await provider.request({
    method: "eth_sendTransaction",
    params: [{
      from: step.address,
      to: tx.to,
      data: tx.data,
      value: `0x${BigInt(tx.value || "0").toString(16)}`,
      ...(tx.gas && { gas: `0x${BigInt(tx.gas).toString(16)}` }),
    }],
  })) as string;
  onPhase("confirming");
  await waitEvmReceipt(provider, hash);
  return hash;
}
