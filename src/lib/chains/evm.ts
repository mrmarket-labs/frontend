import { canonicalAsset, classify } from "../classify";
import { getJson } from "../http";
import { coingeckoPrices } from "../prices";
import type { Chain, Holding } from "../types";

interface Token {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  coingeckoId: string;
}

interface EvmChain {
  chain: Chain;
  rpc: string;
  native: Omit<Token, "address">;
  tokens: Token[];
}

const ETH_NATIVE = { symbol: "ETH", name: "Ether", decimals: 18, coingeckoId: "ethereum" };

// Curated majors per chain. Full token discovery needs an indexer (Alchemy, Moralis);
// this covers what most portfolios actually hold without an API key.
export const EVM_CHAINS: EvmChain[] = [
  {
    chain: "ethereum",
    rpc: process.env.ETHEREUM_RPC_URL ?? "https://ethereum-rpc.publicnode.com",
    native: ETH_NATIVE,
    tokens: [
      { symbol: "USDC", name: "USD Coin", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6, coingeckoId: "usd-coin" },
      { symbol: "USDT", name: "Tether", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6, coingeckoId: "tether" },
      { symbol: "DAI", name: "Dai", address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", decimals: 18, coingeckoId: "dai" },
      { symbol: "WETH", name: "Wrapped Ether", address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", decimals: 18, coingeckoId: "weth" },
      { symbol: "stETH", name: "Lido Staked Ether", address: "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84", decimals: 18, coingeckoId: "staked-ether" },
      { symbol: "wstETH", name: "Wrapped stETH", address: "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0", decimals: 18, coingeckoId: "wrapped-steth" },
      { symbol: "WBTC", name: "Wrapped Bitcoin", address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", decimals: 8, coingeckoId: "wrapped-bitcoin" },
      { symbol: "cbBTC", name: "Coinbase Wrapped BTC", address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", decimals: 8, coingeckoId: "coinbase-wrapped-btc" },
      { symbol: "LINK", name: "Chainlink", address: "0x514910771AF9Ca656af840dff83E8264EcF986CA", decimals: 18, coingeckoId: "chainlink" },
      { symbol: "UNI", name: "Uniswap", address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", decimals: 18, coingeckoId: "uniswap" },
      { symbol: "AAVE", name: "Aave", address: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9", decimals: 18, coingeckoId: "aave" },
      { symbol: "PAXG", name: "PAX Gold", address: "0x45804880De22913dAFE09f4980848ECE6EcbAf78", decimals: 18, coingeckoId: "pax-gold" },
      { symbol: "PEPE", name: "Pepe", address: "0x6982508145454Ce325dDbE47a25d4ec3d2311933", decimals: 18, coingeckoId: "pepe" },
    ],
  },
  {
    chain: "base",
    rpc: process.env.BASE_RPC_URL ?? "https://base-rpc.publicnode.com",
    native: ETH_NATIVE,
    tokens: [
      { symbol: "USDC", name: "USD Coin", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6, coingeckoId: "usd-coin" },
      { symbol: "WETH", name: "Wrapped Ether", address: "0x4200000000000000000000000000000000000006", decimals: 18, coingeckoId: "weth" },
      { symbol: "cbBTC", name: "Coinbase Wrapped BTC", address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", decimals: 8, coingeckoId: "coinbase-wrapped-btc" },
      { symbol: "AERO", name: "Aerodrome", address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", decimals: 18, coingeckoId: "aerodrome-finance" },
    ],
  },
  {
    chain: "arbitrum",
    rpc: process.env.ARBITRUM_RPC_URL ?? "https://arbitrum-one-rpc.publicnode.com",
    native: ETH_NATIVE,
    tokens: [
      { symbol: "USDC", name: "USD Coin", address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6, coingeckoId: "usd-coin" },
      { symbol: "USDT", name: "Tether", address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6, coingeckoId: "tether" },
      { symbol: "WETH", name: "Wrapped Ether", address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", decimals: 18, coingeckoId: "weth" },
      { symbol: "WBTC", name: "Wrapped Bitcoin", address: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f", decimals: 8, coingeckoId: "wrapped-bitcoin" },
      { symbol: "ARB", name: "Arbitrum", address: "0x912CE59144191C1204E64559FE8253a0e49E6548", decimals: 18, coingeckoId: "arbitrum" },
    ],
  },
  {
    chain: "optimism",
    rpc: process.env.OPTIMISM_RPC_URL ?? "https://optimism-rpc.publicnode.com",
    native: ETH_NATIVE,
    tokens: [
      { symbol: "USDC", name: "USD Coin", address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", decimals: 6, coingeckoId: "usd-coin" },
      { symbol: "WETH", name: "Wrapped Ether", address: "0x4200000000000000000000000000000000000006", decimals: 18, coingeckoId: "weth" },
      { symbol: "OP", name: "Optimism", address: "0x4200000000000000000000000000000000000042", decimals: 18, coingeckoId: "optimism" },
    ],
  },
  {
    chain: "polygon",
    rpc: process.env.POLYGON_RPC_URL ?? "https://polygon-bor-rpc.publicnode.com",
    native: { symbol: "POL", name: "Polygon", decimals: 18, coingeckoId: "polygon-ecosystem-token" },
    tokens: [
      { symbol: "USDC", name: "USD Coin", address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", decimals: 6, coingeckoId: "usd-coin" },
      { symbol: "USDT", name: "Tether", address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", decimals: 6, coingeckoId: "tether" },
      { symbol: "WETH", name: "Wrapped Ether", address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", decimals: 18, coingeckoId: "weth" },
    ],
  },
];

const MIN_VALUE_USD = 1;
const BALANCE_OF = "0x70a08231";

export function isEvmAddress(address: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(address);
}

function toUnits(hex: string | undefined, decimals: number): number {
  if (!hex || hex === "0x") return 0;
  const raw = BigInt(hex);
  const base = BigInt(10) ** BigInt(decimals);
  return Number(raw / base) + Number(raw % base) / Number(base);
}

/** One JSON-RPC batch per chain: native balance + balanceOf for every curated token. */
async function scanChain(cfg: EvmChain, address: string): Promise<{ token: Omit<Token, "address">; amount: number }[]> {
  const data = BALANCE_OF + address.slice(2).toLowerCase().padStart(64, "0");
  const calls = [
    { jsonrpc: "2.0", id: 0, method: "eth_getBalance", params: [address, "latest"] },
    ...cfg.tokens.map((t, i) => ({
      jsonrpc: "2.0",
      id: i + 1,
      method: "eth_call",
      params: [{ to: t.address, data }, "latest"],
    })),
  ];
  const results = await getJson<{ id: number; result?: string }[]>(cfg.rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(calls),
  });
  const byId = new Map(results.map((r) => [r.id, r.result]));
  return [cfg.native, ...cfg.tokens].map((token, i) => ({
    token,
    amount: toUnits(byId.get(i), token.decimals),
  }));
}

export async function scanEvm(address: string): Promise<{ holdings: Holding[]; failedChains: Chain[] }> {
  const settled = await Promise.allSettled(EVM_CHAINS.map((cfg) => scanChain(cfg, address)));
  const failedChains: Chain[] = [];
  const found: { chain: Chain; token: Omit<Token, "address">; amount: number }[] = [];
  settled.forEach((r, i) => {
    if (r.status === "rejected") failedChains.push(EVM_CHAINS[i].chain);
    else for (const b of r.value) if (b.amount > 0) found.push({ chain: EVM_CHAINS[i].chain, ...b });
  });

  const prices = await coingeckoPrices(found.map((f) => f.token.coingeckoId));
  const holdings = found.flatMap(({ chain, token, amount }): Holding[] => {
    const priceUsd = prices[token.coingeckoId] ?? 0;
    const valueUsd = amount * priceUsd;
    if (valueUsd < MIN_VALUE_USD) return [];
    return [{
      chain,
      address,
      symbol: token.symbol,
      name: token.name,
      asset: canonicalAsset(token.symbol),
      category: classify(token.symbol),
      amount,
      priceUsd,
      valueUsd,
    }];
  });
  return { holdings, failedChains };
}
