# Diversify

> The best strategy for crypto is to hold. But are you holding the right assets?

Paste your Solana, Ethereum/L2 and Bitcoin addresses. Diversify reads your balances, scores current market
conditions, and asks Claude to propose a target allocation through the lens of an investor philosophy
(Munger, Buffett, Dalio, Taleb, Bogle, Cathie Wood). It then computes the trades to get there.

## Run it

```bash
cp .env.example .env.local   # add ANTHROPIC_API_KEY
npm install
npm run dev
```

Open http://localhost:3000.

## How it works

| Step | Code | Source |
|---|---|---|
| Solana balances (SOL, SPL + Token-2022, incl. xStocks) | `src/lib/chains/solana.ts` | Solana RPC + Jupiter token API (price, tags, verification, liquidity) |
| EVM balances (ETH, Base, Arbitrum, Optimism, Polygon) | `src/lib/chains/evm.ts` | Public RPCs, one batched call per chain over a curated token list |
| Bitcoin balance (address or xpub/ypub/zpub) | `src/lib/chains/bitcoin.ts` | mempool.space, Trezor Blockbook for xpubs |
| Market regime | `src/lib/market.ts` | CoinGecko (200d BTC/ETH/SOL history, dominance) + Fear & Greed index |
| Allocation | `src/lib/advisor.ts` | Claude Opus 5.5, structured output validated with Zod |
| Trades | `src/lib/rebalance.ts` | Deterministic diff of current vs target, ignoring moves under 1% |

Holdings roll up to a canonical asset (WBTC/cbBTC → BTC, JitoSOL/wstETH → SOL/ETH), so the advisor reasons
about economic exposure, not wrappers. On Solana, unverified tokens and positions larger than 25% of the token's
DEX liquidity are skipped as likely spam.

## Known limits / next steps

- **EVM token discovery** covers a curated list of majors. Plug in an indexer (Alchemy, Moralis) to see everything.
- **Swap execution with a fee**: route rebalances through Jupiter (Solana, `platformFeeBps`) and 0x / 1inch (EVM)
  with an integrator fee. The UI has a placeholder button.
- **Backtest**: show "your portfolio vs target vs just holding BTC" over the last year to sell the thesis.
- Public RPCs and CoinGecko's free tier are rate-limited; set the optional env vars for production.

Not financial advice. Personas are inspired by publicly known philosophies and aren't affiliated with those people.
