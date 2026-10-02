import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod/v4";
import { CATEGORY_LABELS } from "./classify";
import type { Horizon, RiskLevel } from "./options";
import type { Persona } from "./personas";
import type { Category, Holding, MarketSnapshot } from "./types";

const CATEGORIES = Object.keys(CATEGORY_LABELS) as [Category, ...Category[]];

/**
 * What the advisor may recommend. Keeping the universe explicit stops the model from
 * inventing tickers and keeps every suggestion buyable on Solana or EVM DEXes.
 */
const UNIVERSE = `
Stablecoins: USDC, USDT
Bitcoin: BTC (native, or cbBTC/WBTC on EVM)
Ethereum: ETH (native or staked, e.g. wstETH)
Solana: SOL (native or staked, e.g. JitoSOL)
Large-cap alts: LINK, AAVE, JUP, HYPE
Tokenized gold: PAXG, XAUT
Tokenized stocks on Solana (xStocks): SPYx (S&P 500), QQQx (Nasdaq 100), NVDAx, AAPLx, GOOGLx, TSLAx, COINx, MSTRx, CRCLx
Speculative: any speculative token the user already holds (keep, trim or exit it; never introduce new memecoins)
`.trim();

export const AdviceSchema = z.object({
  verdict: z.string().describe("One punchy sentence answering: is the user holding the right assets?"),
  diagnosis: z.string().describe("2-4 sentences on what is wrong or right with the current portfolio: concentration, risk, idle assets."),
  marketView: z.string().describe("2-3 sentences on current crypto market conditions and how they shape this allocation."),
  personaTake: z.string().describe("2-3 sentences in the spirit of the persona's philosophy explaining the approach. Do not fabricate quotes."),
  currentRiskScore: z.number().int().describe("1 (very safe) to 10 (extremely risky)"),
  targetRiskScore: z.number().int().describe("1 (very safe) to 10 (extremely risky)"),
  allocations: z
    .array(
      z.object({
        asset: z.string().describe("Canonical symbol from the investable universe, e.g. BTC, SOL, USDC, SPYx"),
        category: z.enum(CATEGORIES),
        targetPct: z.number().describe("Percent of total portfolio; all allocations sum to 100"),
        role: z.enum(["defensive", "core", "growth", "speculative"]),
        rationale: z.string().describe("One sentence"),
      }),
    )
    .describe("Target portfolio, 3-10 positions"),
  risks: z.array(z.string()).describe("2-4 specific risks of the target portfolio (depegs, custody, tokenized-stock issuer risk, ...)"),
  executionTips: z.array(z.string()).describe("2-4 practical tips: staging entries, fees, tax, staking idle SOL/ETH"),
});
export type Advice = z.infer<typeof AdviceSchema>;

export interface AdviceRequest {
  holdings: Holding[];
  persona: Persona;
  risk: RiskLevel;
  horizon: Horizon;
  market: MarketSnapshot;
}

function describePortfolio(holdings: Holding[]): string {
  const total = holdings.reduce((s, h) => s + h.valueUsd, 0);
  const byAsset = new Map<string, { value: number; category: Category; where: Set<string> }>();
  for (const h of holdings) {
    const entry = byAsset.get(h.asset) ?? { value: 0, category: h.category, where: new Set<string>() };
    entry.value += h.valueUsd;
    entry.where.add(`${h.symbol} on ${h.chain}`);
    byAsset.set(h.asset, entry);
  }
  const lines = [...byAsset.entries()]
    .sort((a, b) => b[1].value - a[1].value)
    .map(([asset, e]) =>
      `- ${asset} [${e.category}]: $${e.value.toFixed(0)} (${((e.value / total) * 100).toFixed(1)}%) held as ${[...e.where].join(", ")}`,
    );
  return `Total: $${total.toFixed(0)}\n${lines.join("\n")}`;
}

function describeMarket(m: MarketSnapshot): string {
  const fmt = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
  return [
    `As of ${m.asOf}. Rule-based regime: ${m.regime} (score ${m.regimeScore} on -100..100).`,
    m.fearGreed && `Fear & Greed index: ${m.fearGreed.value} (${m.fearGreed.label}).`,
    m.btcDominance != null && `BTC dominance: ${m.btcDominance.toFixed(1)}%.`,
    m.marketCapChange24h != null && `Total crypto market cap 24h change: ${fmt(m.marketCapChange24h)}.`,
    ...m.assets.map(
      (a) =>
        `${a.symbol}: $${a.price.toFixed(2)}, 30d ${fmt(a.change30d)}, 90d ${fmt(a.change90d)}, vs 50d avg ${fmt(a.vsSma50)}, ` +
        `vs 200d avg ${fmt(a.vsSma200)}, 30d annualized vol ${a.volatility30d.toFixed(0)}%, drawdown from 200d high ${fmt(a.drawdownFromHigh)}.`,
    ),
  ]
    .filter(Boolean)
    .join("\n");
}

const SYSTEM = `You are the portfolio engine of a crypto app whose thesis is: "The best strategy for crypto is to hold, but are you holding the right assets?"
You analyze a user's on-chain holdings and propose a target allocation that a long-term holder could rebalance into once and then mostly leave alone.

Rules:
- Reason through the lens of the selected investor's publicly known philosophy. You are inspired by them; never claim to be them or invent quotes.
- Pick only from the investable universe given. Use canonical symbols (BTC not WBTC, SOL not JitoSOL).
- Respect the user's risk tolerance and horizon; let current market conditions tilt the allocation (e.g. more stablecoins in euphoric or downtrending markets, more risk when fear is extreme and trend is turning up), but the persona's philosophy dominates.
- Prefer fewer, larger positions over many tiny ones. Minimize unnecessary trades, since every swap costs fees and active trading rarely beats holding.
- Percentages must sum to exactly 100.
- Be direct and specific. This is educational analysis, not personalized financial advice.`;

export async function generateAdvice(req: AdviceRequest): Promise<Advice> {
  const client = new Anthropic();
  const prompt = `Investor lens: ${req.persona.name}
Philosophy: ${req.persona.philosophy}

User risk tolerance: ${req.risk}
User horizon: ${req.horizon}

Current portfolio:
${describePortfolio(req.holdings)}

Market conditions:
${describeMarket(req.market)}

Investable universe:
${UNIVERSE}

Diagnose the current portfolio and propose the target allocation.`;

  const response = await client.beta.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "high", format: betaZodOutputFormat(AdviceSchema) },
    system: SYSTEM,
    messages: [{ role: "user", content: prompt }],
  });

  if (response.stop_reason === "refusal") throw new Error("The model declined to produce advice for this portfolio.");
  if (response.stop_reason === "max_tokens") throw new Error("The advice was cut off. Please try again.");
  if (!response.parsed_output) throw new Error("The model returned an unexpected format.");
  return normalize(response.parsed_output);
}

/** Guard against rounding drift so the target always sums to 100. */
function normalize(advice: Advice): Advice {
  const allocations = advice.allocations.filter((a) => a.targetPct > 0);
  const sum = allocations.reduce((s, a) => s + a.targetPct, 0);
  return {
    ...advice,
    allocations: allocations
      .map((a) => ({ ...a, asset: a.asset.trim(), targetPct: (a.targetPct / sum) * 100 }))
      .sort((a, b) => b.targetPct - a.targetPct),
  };
}
