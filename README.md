# Invest Like Buffett

> The best strategy for crypto is to hold. But are you holding the right assets?

Connect Phantom (Solana, Ethereum and Bitcoin in one go) or any EVM wallet, or just watch addresses.
Invest Like Buffett reads your balances, scores current market conditions, and asks Claude to propose a target
allocation through the lens of an investor philosophy (Munger, Buffett, Dalio, Taleb, Bogle, Cathie Wood).
It then turns the difference into a rebalance plan of same-chain swaps you sign in your own wallet.

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
| Rebalance plan | `src/lib/plan.ts` | Pairs sells and buys per chain into direct swaps; stablecoin buys go wherever proceeds are; the rest is manual |
| Wallets | `src/lib/wallets/` | Phantom multi-chain + EIP-6963 EVM wallets, watched addresses, localStorage persistence |
| Swap execution | `src/app/api/swap/*`, `src/lib/wallets/execute.ts` | Jupiter (Solana) and 0x (EVM) quotes with a 0.5% integrator fee; exact-amount approvals; signed client-side |

Holdings roll up to a canonical asset (WBTC/cbBTC → BTC, JitoSOL/wstETH → SOL/ETH), so the advisor reasons
about economic exposure, not wrappers. On Solana, unverified tokens and positions larger than 25% of the token's
DEX liquidity are skipped as likely spam.

## Swaps and fees

Phase 1 executes **same-chain swaps on Solana (Jupiter) and Ethereum/L2s (0x)**. Everything else (Bitcoin,
Hyperliquid, bridges) appears in the plan as a manual step. The app never holds funds: every swap is a
transaction the user signs in their own wallet.

- `SWAP_FEE_BPS` (default 50 = 0.5%) is charged via the aggregators' integrator-fee features.
- `FEE_WALLET_EVM` receives 0x fees in the sold token. `FEE_WALLET_SOLANA` receives Jupiter fees, but only
  into token accounts that already exist: create (W)SOL and USDC token accounts in that wallet, or the fee is
  skipped on that trade.
- `ZEROX_API_KEY` is required for EVM swaps (free at dashboard.0x.org). Without it EVM steps show an error.

## Abuse protection

Every advisor run costs real money (Claude), so `/api/advise` is gated:

- **Wallet sign-in**: the user signs a free message (Solana `signMessage` or EVM `personal_sign`); the server
  verifies it, checks the wallet holds at least `MIN_SIGNIN_USD`, and sets an HMAC-signed session cookie
  (`AUTH_SECRET`). Throwaway wallets can't farm the endpoint because empty ones are refused.
- **Quotas**: a global daily cap (`ADVICE_DAILY_CAP`, the hard ceiling on spend), per-wallet per day
  (`ADVICE_PER_WALLET_DAY`) and per-IP per hour. Portfolio scans and swap quotes are rate limited too.
- **Cache**: identical questions (same portfolio shape, persona, risk, horizon, market regime) are served
  from a one-hour cache and don't count against quotas.
- Counters live in Upstash Redis (`UPSTASH_REDIS_REST_URL/TOKEN`, add via the Vercel marketplace). Without it
  the app still works but limits are per serverless instance, which is not real protection.
- Also set a monthly spend limit in the Anthropic Console as the final backstop.

## Known limits / next steps

- **EVM token discovery** covers a curated list of majors. Plug in an indexer (Alchemy, Moralis) to see everything.
- **Hyperliquid execution** (builder codes) and **cross-chain via LI.FI**, including native BTC: planned phases 2 and 3.
- **Other Solana wallets** (Solflare, Backpack) via Wallet Standard; only Phantom signs Solana swaps today.
- **Region restrictions**: xStocks and trade.xyz perps aren't available to US persons; not enforced yet.
- **Backtest**: show "your portfolio vs target vs just holding BTC" over the last year to sell the thesis.
- Public RPCs and CoinGecko's free tier are rate-limited; set the optional env vars for production.

Not financial advice. Personas are inspired by publicly known philosophies and aren't affiliated with those people.
