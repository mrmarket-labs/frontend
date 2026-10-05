import type { SwapStep } from "../plan";
import { EVM_CHAIN_IDS, EVM_CHAIN_PARAMS, NATIVE, ZEROX_NATIVE, fromRawUnits, toRawUnits, type EvmExecChain } from "../tokens";
import { getEvmWallet } from "./eip6963";
import { phantomEvmProvider, phantomSignAndSendSolana } from "./phantom";
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

export type Quote = SolanaQuote | EvmQuote;
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

async function waitSolana(signature: string): Promise<void> {
  for (let i = 0; i < 45; i++) {
    const s = await api<{ status: "pending" | "confirmed" | "failed"; error?: string }>(`/api/swap/solana/status?signature=${signature}`);
    if (s.status === "confirmed") return;
    if (s.status === "failed") throw new Error(`Transaction failed on-chain: ${s.error ?? "unknown error"}`);
    await sleep(2000);
  }
  throw new Error("Not confirmed after 90s. Check the explorer link before retrying.");
}

function evmProviderFor(wallet: Wallet): Eip1193Provider {
  const p = wallet.provider === "phantom" ? phantomEvmProvider() : getEvmWallet(wallet.provider?.replace("eip6963:", "") ?? "")?.provider;
  if (!p) throw new Error(`${wallet.label} isn't available in this browser. Reconnect it and retry.`);
  return p;
}

async function ensureEvmAccount(provider: Eip1193Provider, address: string): Promise<void> {
  const has = (accounts: string[]) => accounts.some((a) => a.toLowerCase() === address.toLowerCase());
  if (has((await provider.request({ method: "eth_accounts" })) as string[])) return;
  if (has((await provider.request({ method: "eth_requestAccounts" })) as string[])) return;
  throw new Error(`Switch your wallet to ${address.slice(0, 6)}…${address.slice(-4)} and retry.`);
}

async function ensureEvmChain(provider: Eip1193Provider, chain: EvmExecChain): Promise<void> {
  const chainId = `0x${EVM_CHAIN_IDS[chain].toString(16)}`;
  if ((await provider.request({ method: "eth_chainId" })) === chainId) return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  } catch (e) {
    if ((e as { code?: number }).code !== 4902) throw new Error(`Switch your wallet to ${EVM_CHAIN_PARAMS[chain].chainName} and retry.`);
    await provider.request({ method: "wallet_addEthereumChain", params: [{ chainId, ...EVM_CHAIN_PARAMS[chain] }] });
  }
}

async function waitEvmReceipt(provider: Eip1193Provider, hash: string): Promise<void> {
  for (let i = 0; i < 60; i++) {
    const receipt = (await provider.request({ method: "eth_getTransactionReceipt", params: [hash] })) as { status: string } | null;
    if (receipt) {
      if (receipt.status === "0x1") return;
      throw new Error("Transaction reverted on-chain.");
    }
    await sleep(3000);
  }
  throw new Error("Not confirmed after 3 minutes. Check the explorer link before retrying.");
}

const pad = (hex: string) => hex.replace(/^0x/, "").padStart(64, "0");
/** ERC-20 approve(spender, amount) for exactly the amount being sold: no unlimited approvals. */
function approveData(spender: string, amount: string): string {
  return `0x095ea7b3${pad(spender)}${pad(BigInt(amount).toString(16))}`;
}

export async function executeStep(step: SwapStep, wallet: Wallet, quote: Quote, onPhase: (p: Phase) => void): Promise<string> {
  if (quote.kind === "solana") {
    if (wallet.provider !== "phantom") throw new Error("Only Phantom can sign Solana swaps right now.");
    onPhase("signing");
    const signature = await phantomSignAndSendSolana(quote.swapTransaction, step.address);
    onPhase("confirming");
    await waitSolana(signature);
    return signature;
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
