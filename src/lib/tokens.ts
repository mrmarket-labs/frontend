import { EVM_CHAINS } from "./chains/evm";
import { hlTokenInfo } from "./hyperliquid/spot";
import type { Chain } from "./types";

/** Chains where the app can execute itself: Jupiter on Solana, 0x on EVM, spot orders on Hyperliquid. */
export type EvmExecChain = "ethereum" | "base" | "arbitrum" | "optimism" | "polygon";
export type ExecChain = "solana" | "hyperliquid" | EvmExecChain;

export const EVM_EXEC_CHAINS: EvmExecChain[] = ["ethereum", "base", "arbitrum", "optimism", "polygon"];
export const L2_CHAINS: EvmExecChain[] = ["arbitrum", "base", "optimism", "polygon"];

export function isExecChain(chain: Chain): chain is ExecChain {
  return chain === "solana" || chain === "hyperliquid" || (EVM_EXEC_CHAINS as Chain[]).includes(chain);
}

/** Marker address for a chain's native coin (ETH, POL). 0x uses its own sentinel, see below. */
export const NATIVE = "native";
export const ZEROX_NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

export interface TokenInfo {
  symbol: string;
  /** Mint on Solana; contract address or NATIVE on EVM; "hl:<token index>" on Hyperliquid. */
  address: string;
  decimals: number;
}

export const WSOL_MINT = "So11111111111111111111111111111111111111112";

const SOLANA_TOKENS: TokenInfo[] = [
  { symbol: "SOL", address: WSOL_MINT, decimals: 9 },
  { symbol: "USDC", address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 },
  { symbol: "USDT", address: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", decimals: 6 },
  { symbol: "JitoSOL", address: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn", decimals: 9 },
  { symbol: "JUP", address: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", decimals: 6 },
  { symbol: "PAXG", address: "5GgRAEmv8ZxF2PR5hY72Qs5x1bnQ6UK2RbTPoqJ3wSwW", decimals: 6 },
  // xStocks (Token-2022)
  { symbol: "SPYx", address: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W", decimals: 8 },
  { symbol: "QQQx", address: "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ", decimals: 8 },
  { symbol: "NVDAx", address: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", decimals: 8 },
  { symbol: "AAPLx", address: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", decimals: 8 },
  { symbol: "GOOGLx", address: "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN", decimals: 8 },
  { symbol: "TSLAx", address: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB", decimals: 8 },
  { symbol: "COINx", address: "Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu", decimals: 8 },
  { symbol: "MSTRx", address: "XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ", decimals: 8 },
  { symbol: "CRCLx", address: "XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1", decimals: 8 },
];

/** Tokens the advisor may suggest that aren't in the balance scanner's list. */
const EVM_EXTRA: Partial<Record<EvmExecChain, TokenInfo[]>> = {
  ethereum: [{ symbol: "XAUT", address: "0x68749665FF8D2d112Fa859AA293F07A622782F38", decimals: 6 }],
};

const EVM_TOKENS: Record<EvmExecChain, TokenInfo[]> = Object.fromEntries(
  EVM_EXEC_CHAINS.map((chain) => {
    const cfg = EVM_CHAINS.find((c) => c.chain === chain)!;
    return [
      chain,
      [
        { symbol: cfg.native.symbol, address: NATIVE, decimals: cfg.native.decimals },
        ...cfg.tokens.map((t) => ({ symbol: t.symbol, address: t.address, decimals: t.decimals })),
        ...(EVM_EXTRA[chain] ?? []),
      ],
    ];
  }),
) as Record<EvmExecChain, TokenInfo[]>;

/** Advisor instrument names that map to a different ticker on a given chain. */
const INSTRUMENT_ALIASES: Record<string, string> = { WSOL: "SOL", "USD COIN": "USDC" };

export function resolveToken(chain: ExecChain, symbol: string): TokenInfo | null {
  const wanted = (INSTRUMENT_ALIASES[symbol.toUpperCase()] ?? symbol).toUpperCase();
  if (chain === "hyperliquid") return hlTokenInfo(wanted);
  const list = chain === "solana" ? SOLANA_TOKENS : EVM_TOKENS[chain];
  return list.find((t) => t.symbol.toUpperCase() === wanted) ?? null;
}

export const EVM_CHAIN_IDS: Record<EvmExecChain, number> = {
  ethereum: 1,
  base: 8453,
  arbitrum: 42161,
  optimism: 10,
  polygon: 137,
};

/** Native coin to leave behind so the wallet can still pay for transactions. */
export const GAS_RESERVE: Record<ExecChain, number> = {
  solana: 0.02,
  hyperliquid: 0,
  ethereum: 0.004,
  base: 0.0005,
  arbitrum: 0.0005,
  optimism: 0.0005,
  polygon: 1,
};

export const EXPLORER_TX: Record<ExecChain, string> = {
  solana: "https://solscan.io/tx/",
  hyperliquid: "https://app.hyperliquid.xyz/explorer/tx/",
  ethereum: "https://etherscan.io/tx/",
  base: "https://basescan.org/tx/",
  arbitrum: "https://arbiscan.io/tx/",
  optimism: "https://optimistic.etherscan.io/tx/",
  polygon: "https://polygonscan.com/tx/",
};

/** Params for wallet_addEthereumChain when a wallet doesn't know an L2 yet. */
export const EVM_CHAIN_PARAMS: Record<EvmExecChain, { chainName: string; rpcUrls: string[]; nativeCurrency: { name: string; symbol: string; decimals: number }; blockExplorerUrls: string[] }> = {
  ethereum: { chainName: "Ethereum", rpcUrls: ["https://ethereum-rpc.publicnode.com"], nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, blockExplorerUrls: ["https://etherscan.io"] },
  base: { chainName: "Base", rpcUrls: ["https://mainnet.base.org"], nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, blockExplorerUrls: ["https://basescan.org"] },
  arbitrum: { chainName: "Arbitrum One", rpcUrls: ["https://arb1.arbitrum.io/rpc"], nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, blockExplorerUrls: ["https://arbiscan.io"] },
  optimism: { chainName: "OP Mainnet", rpcUrls: ["https://mainnet.optimism.io"], nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, blockExplorerUrls: ["https://optimistic.etherscan.io"] },
  polygon: { chainName: "Polygon", rpcUrls: ["https://polygon-rpc.com"], nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 }, blockExplorerUrls: ["https://polygonscan.com"] },
};

/** Convert a UI amount to raw units as a decimal string, avoiding float drift on large decimals. */
export function toRawUnits(amount: number, decimals: number): string {
  const [whole, frac = ""] = amount.toFixed(decimals).split(".");
  return (BigInt(whole) * BigInt(10) ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0")).toString();
}

export function fromRawUnits(raw: string | bigint, decimals: number): number {
  const value = BigInt(raw);
  const base = BigInt(10) ** BigInt(decimals);
  return Number(value / base) + Number(value % base) / Number(base);
}
