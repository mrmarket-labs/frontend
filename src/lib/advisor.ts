import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod/v4";
import { CATEGORY_LABELS } from "./classify";
import { VENUES, type Horizon, type RiskLevel } from "./options";
import type { Persona } from "./personas";
import type { Category, Holding, MarketSnapshot, PerpPosition } from "./types";
import type { HyperliquidVenues } from "./venues";

const CATEGORIES = Object.keys(CATEGORY_LABELS) as [Category, ...Category[]];

const usdK = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1e3)}k`);

/**
 * What the advisor may recommend, and where it can be bought. Keeping the universe explicit stops
 * the model from inventing tickers and keeps every suggestion executable on a known venue.
 */
function buildUniverse(venues: HyperliquidVenues | null, allowPerps: boolean): string {
  const spotVol = (token: string) => {
    const m = venues?.spot.find((x) => x.token === token);
    return m ? ` (24h volume ${usdK(m.volume24hUsd)})` : "";
  };
  const lines = [
    "Format: canonical asset -> where to buy it (venue: instrument). Use the canonical asset in `asset` and the exact ticker in `instrument`.",
    "USDC, USDT -> any chain the user already holds funds on",
    "BTC -> bitcoin: BTC | ethereum or ethereum-l2: cbBTC/WBTC | hyperliquid-spot: UBTC",
    "ETH -> ethereum or ethereum-l2: ETH or wstETH (staked) | hyperliquid-spot: UETH",
    "SOL -> solana: SOL or JitoSOL (staked)",
    "LINK, AAVE -> ethereum | JUP -> solana | HYPE -> hyperliquid-spot: HYPE (can be staked)",
    `GOLD -> hyperliquid-spot: XAUT0${spotVol("XAUT0")} | ethereum: PAXG or XAUT | solana: PAXG`,
    "Tokenized stocks (canonical = xStock ticker in caps, e.g. SPYX, QQQX, NVDAX, AAPLX, GOOGLX, TSLAX, COINX, MSTRX, CRCLX) ->",
    "  solana: SPYx, QQQx, NVDAx, AAPLx, GOOGLx, TSLAx, COINx, MSTRx, CRCLx (xStocks; deepest spot liquidity)",
    `  hyperliquid-spot: SPYX${spotVol("SPYX")}, NVDAX${spotVol("NVDAX")}, QQQX${spotVol("QQQX")} (thin; only for small sizes)`,
    "Speculative -> only tokens the user already holds (keep, trim or exit; never introduce new memecoins)",
  ];
  if (allowPerps && venues?.perps.length) {
    lines.push(
      "Perps (user opted in) -> hyperliquid-perp, 1x long only, canonical asset = market + \"-PERP\":",
      ...venues.perps.map(
        (p) =>
          `  ${p.market}-PERP (instrument xyz:${p.market}): 24h volume ${usdK(p.volume24hUsd)}, a 1x long currently pays ${p.longFundingApr.toFixed(1)}%/yr funding`,
      ),
    );
  } else {
    lines.push("Perps: NOT allowed. Never use venue hyperliquid-perp.");
  }
  return lines.join("\n");
}

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
        asset: z.string().describe("Canonical asset from the investable universe, e.g. BTC, SOL, USDC, GOLD, SPYX, SP500-PERP"),
        venue: z.enum(VENUES).describe("Where to buy or hold it"),
        instrument: z.string().describe("Exact token or market to buy on that venue, e.g. XAUT0, SPYx, cbBTC, xyz:SP500"),
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
  positions: PerpPosition[];
  persona: Persona;
  risk: RiskLevel;
  horizon: Horizon;
  allowPerps: boolean;
  market: MarketSnapshot;
  venues: HyperliquidVenues | null;
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

function describePositions(positions: PerpPosition[], holdings: Holding[]): string {
  if (positions.length === 0) return "None.";
  const total = holdings.reduce((s, h) => s + h.valueUsd, 0) || 1;
  const notional = positions.reduce((s, p) => s + p.notionalUsd, 0);
  const lines = positions.map(
    (p) =>
      `- ${p.side.toUpperCase()} ${p.coin} perp on ${p.venue}: $${p.notionalUsd.toFixed(0)} notional at ${p.leverage}x, ` +
      `unrealized PnL $${p.unrealizedPnlUsd.toFixed(0)}${p.liquidationPx ? `, liquidation at $${p.liquidationPx}` : ""}`,
  );
  return `Total notional $${notional.toFixed(0)} (${(notional / total).toFixed(2)}x the portfolio's net value)\n${lines.join("\n")}`;
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
- Pick only from the investable universe given. Use canonical assets (BTC not WBTC, SOL not JitoSOL, GOLD not PAXG) and name the venue and exact instrument for each.
- Choose venues to minimize friction: prefer a venue where the user already holds that asset or the stablecoins to fund it, so no bridging is needed. Override this when that venue's daily volume is too thin for the order (avoid orders above ~5% of 24h volume).
- This is a buy-and-hold app: own spot assets. Only if perps are allowed, use a 1x long perp where it clearly beats spot (spot too illiquid or unavailable, or a short horizon), state its annual funding cost in the rationale, and keep perps a minority of the portfolio.
- Respect the user's risk tolerance and horizon; let current market conditions tilt the allocation (e.g. more stablecoins in euphoric or downtrending markets, more risk when fear is extreme and trend is turning up), but the persona's philosophy dominates.
- Prefer fewer, larger positions over many tiny ones. Minimize unnecessary trades, since every swap costs fees and active trading rarely beats holding.
- Percentages must sum to exactly 100.
- Leveraged perp positions are exposure on top of the holdings (their margin is already inside the holdings). Account for them in the diagnosis, risk scores and risks, and say plainly whether the persona would keep, reduce or close them. Allocations cover holdings only; never allocate to perps.
- Be direct and specific. This is educational analysis, not personalized financial advice.`;

export async function generateAdvice(req: AdviceRequest): Promise<Advice> {
  const client = new Anthropic();
  const prompt = `Investor lens: ${req.persona.name}
Philosophy: ${req.persona.philosophy}

User risk tolerance: ${req.risk}
User horizon: ${req.horizon}

Current portfolio:
${describePortfolio(req.holdings)}

Open leveraged perp positions:
${describePositions(req.positions, req.holdings)}

Market conditions:
${describeMarket(req.market)}

Investable universe:
${buildUniverse(req.venues, req.allowPerps)}

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
