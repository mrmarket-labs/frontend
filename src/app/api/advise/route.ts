import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod/v4";
import { generateAdvice } from "@/lib/advisor";
import { CATEGORY_LABELS } from "@/lib/classify";
import { getMarketSnapshot } from "@/lib/market";
import { HORIZONS, RISK_LEVELS } from "@/lib/options";
import { getPersona } from "@/lib/personas";
import { rateLimit } from "@/lib/rate-limit";
import { getHyperliquidVenues } from "@/lib/venues";
import { computeTrades } from "@/lib/rebalance";
import type { Category } from "@/lib/types";

export const maxDuration = 300;

const ADVICE_PER_HOUR = Number(process.env.ADVICE_PER_HOUR || 10);

const RequestSchema = z.object({
  personaId: z.string(),
  risk: z.enum(RISK_LEVELS),
  horizon: z.enum(HORIZONS),
  allowPerps: z.boolean().default(false),
  holdings: z
    .array(
      z.object({
        chain: z.enum(["solana", "bitcoin", "ethereum", "base", "arbitrum", "optimism", "polygon", "hyperliquid", "hyperevm"]),
        address: z.string(),
        symbol: z.string(),
        name: z.string(),
        asset: z.string(),
        category: z.enum(Object.keys(CATEGORY_LABELS) as [Category, ...Category[]]),
        amount: z.number(),
        priceUsd: z.number(),
        valueUsd: z.number(),
        logo: z.string().optional(),
      }),
    )
    .min(1)
    .max(500),
  positions: z
    .array(
      z.object({
        venue: z.literal("hyperliquid"),
        coin: z.string(),
        side: z.enum(["long", "short"]),
        notionalUsd: z.number(),
        leverage: z.number(),
        unrealizedPnlUsd: z.number(),
        liquidationPx: z.number().nullable(),
      }),
    )
    .max(200)
    .default([]),
});

export async function POST(request: Request) {
  const limit = rateLimit(request, ADVICE_PER_HOUR, 60 * 60_000);
  if (!limit.ok)
    return Response.json(
      { error: `You've hit the hourly limit for analyses. Try again in ${Math.ceil(limit.retryAfterSec / 60)} min.` },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSec) } },
    );

  const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });
  const { personaId, risk, horizon, allowPerps, holdings, positions } = parsed.data;
  const persona = getPersona(personaId);
  if (!persona) return Response.json({ error: "Unknown investor persona." }, { status: 400 });

  if (!process.env.ANTHROPIC_API_KEY)
    return Response.json({ error: "Set ANTHROPIC_API_KEY in .env.local to enable the advisor." }, { status: 500 });

  try {
    const [market, venues] = await Promise.all([getMarketSnapshot(), getHyperliquidVenues()]);
    const advice = await generateAdvice({ holdings, positions, persona, risk, horizon, allowPerps, market, venues });
    return Response.json({ advice, trades: computeTrades(holdings, advice), market });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError)
      return Response.json({ error: "Missing or invalid ANTHROPIC_API_KEY on the server." }, { status: 500 });
    if (e instanceof Anthropic.RateLimitError)
      return Response.json({ error: "Rate limited by the Claude API. Try again in a minute." }, { status: 429 });
    if (e instanceof Anthropic.APIError)
      return Response.json({ error: `Claude API error: ${e.message}` }, { status: 502 });
    return Response.json({ error: e instanceof Error ? e.message : "Something went wrong." }, { status: 500 });
  }
}
