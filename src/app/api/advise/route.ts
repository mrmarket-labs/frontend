import { z } from "zod/v4";
import { AdviceError, advisorConfigured, probeAdvisor, requestAdvice } from "@/lib/advisor";
import { CATEGORY_LABELS } from "@/lib/classify";
import { dict, localeFromRequest } from "@/lib/i18n";
import { CADENCES, RISK_LEVELS } from "@/lib/options";
import { getPersona } from "@/lib/personas";
import { readSession } from "@/lib/auth";
import { FOREVER, cacheGet, cacheSet, clientIp, hit, today, tooMany, unhit } from "@/lib/limits";
import { MAX_NOTE_LENGTH, MAX_OUTSIDE, OUTSIDE_KINDS, UNITS, type OutsidePriced } from "@/lib/outside";
import { computeTrades } from "@/lib/rebalance";
import type { Category } from "@/lib/types";

export const maxDuration = 300;

const ADVICE_PER_HOUR = Number(process.env.ADVICE_PER_HOUR || 10);
const ADVICE_PER_WALLET_DAY = Number(process.env.ADVICE_PER_WALLET_DAY || 10);
/** Test analyses a wallet gets, ever; after that, the waitlist for Pro. */
const ADVICE_PER_WALLET_TOTAL = Number(process.env.ADVICE_PER_WALLET_TOTAL || 3);
/** Hard ceiling on daily advisor spend, whatever an attacker does. */
const ADVICE_DAILY_CAP = Number(process.env.ADVICE_DAILY_CAP || 300);
const CACHE_TTL_SEC = 3600;
/** Everyone gets the test tier until Pro opens; the advisor picks the model from it. */
const TIER = "test" as const;

/** Same portfolio shape + same question + same market regime + same prompt → same answer; don't pay twice. */

async function adviceCacheKey(
  holdings: { asset: string; valueUsd: number }[],
  outside: OutsidePriced[],
  params: Record<string, unknown>,
  probe: { regime: string; promptVersion: number | "unknown" },
): Promise<string> {
  const total = holdings.reduce((s, h) => s + h.valueUsd, 0) || 1;
  const byAsset = new Map<string, number>();
  for (const h of holdings) byAsset.set(h.asset.toUpperCase(), (byAsset.get(h.asset.toUpperCase()) ?? 0) + h.valueUsd);
  const shape = [...byAsset.entries()]
    .map(([a, v]) => [a, Math.round((v / total) * 100)] as const)
    .filter(([, pct]) => pct > 0)
    .sort();
  // Outside money is keyed by its weight against the on-chain total, per kind, in coarse steps.
  const byKind = new Map<string, number>();
  for (const h of outside) byKind.set(h.kind, (byKind.get(h.kind) ?? 0) + h.valueUsd);
  const outsideShape = [...byKind.entries()].map(([k, v]) => [k, Math.round((v / total) * 10)] as const).sort();
  const fingerprint = JSON.stringify({ v: probe.promptVersion, shape, outsideShape, size: Math.round(Math.log10(total) * 2), ...params, regime: probe.regime });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(fingerprint));
  return `advcache:${Buffer.from(digest).toString("hex").slice(0, 32)}`;
}

const RequestSchema = z.object({
  personaId: z.string(),
  risk: z.enum(RISK_LEVELS),
  cadence: z.enum(CADENCES),
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
  outside: z
    .array(
      z.object({
        id: z.string().max(40),
        kind: z.enum(OUTSIDE_KINDS),
        amount: z.number().positive().finite(),
        unit: z.enum(UNITS),
        valueUsd: z.number().nonnegative().finite(),
        note: z
          .string()
          .max(MAX_NOTE_LENGTH)
          .transform((s) => s.replace(/\s+/g, " ").trim())
          .optional(),
      }),
    )
    .max(MAX_OUTSIDE)
    .default([]),
});

/** HTTP status for each advisor failure; the message comes from the user's dictionary. */
function statusFor(code: AdviceError["code"]): number {
  switch (code) {
    case "invalidRequest":
    case "unknownPersona":
      return 400;
    case "claudeRateLimited":
      return 429;
    case "advisorNotConfigured":
    case "badApiKey":
      return 500;
    default:
      return 502;
  }
}

export async function POST(request: Request) {
  const locale = localeFromRequest(request);
  const t = dict(locale).api;
  const session = await readSession(request);
  if (!session) return Response.json({ error: t.verifyToRun, code: "auth" }, { status: 401 });

  const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: t.invalidRequest }, { status: 400 });
  const { personaId, risk, cadence, allowPerps, holdings, positions, outside } = parsed.data;
  if (!getPersona(personaId)) return Response.json({ error: t.unknownPersona }, { status: 400 });

  if (!advisorConfigured) return Response.json({ error: t.advisorNotConfigured }, { status: 500 });

  try {
    const probe = await probeAdvisor();
    const cacheKey = await adviceCacheKey(holdings, outside, { personaId, risk, cadence, allowPerps, locale, tier: TIER }, probe);
    const cached = await cacheGet<Awaited<ReturnType<typeof requestAdvice>>>(cacheKey);
    if (cached) return Response.json({ advice: cached, trades: computeTrades(holdings, cached), cached: true });

    // Only uncached requests spend money, so only they count against the limits.
    const hour = Math.floor(Date.now() / 3_600_000);
    const [global, perWallet, perIp] = await Promise.all([
      hit(`adv:day:${today()}`, ADVICE_DAILY_CAP, 86400),
      hit(`adv:wallet:${session.address}:${today()}`, ADVICE_PER_WALLET_DAY, 86400),
      hit(`adv:ip:${clientIp(request)}:${hour}`, ADVICE_PER_HOUR, 3600),
    ]);
    if (!global.ok)
      return Response.json({ error: t.globalLimit, code: "cap" }, { status: 503 });
    if (!perWallet.ok) return tooMany(t.walletLimit(ADVICE_PER_WALLET_DAY), perWallet.retryAfterSec);
    if (!perIp.ok) return tooMany(t.ipLimit(Math.ceil(perIp.retryAfterSec / 60)), perIp.retryAfterSec);
    // Counted last, so a run turned away by the limits above doesn't use up a test analysis.
    const totalKey = `adv:wallet:${session.address}:total`;
    const total = await hit(totalKey, ADVICE_PER_WALLET_TOTAL, FOREVER);
    if (!total.ok) return Response.json({ error: t.testRunsUsed(ADVICE_PER_WALLET_TOTAL), code: "used" }, { status: 429 });

    let advice;
    try {
      advice = await requestAdvice({ personaId, holdings, positions, outside, risk, cadence, allowPerps, locale, tier: TIER });
    } catch (e) {
      // A run that never produced advice shouldn't cost one of the few the wallet gets.
      await unhit(totalKey).catch(() => undefined);
      throw e;
    }
    await cacheSet(cacheKey, advice, CACHE_TTL_SEC);
    return Response.json({ advice, trades: computeTrades(holdings, advice) });
  } catch (e) {
    if (e instanceof AdviceError) {
      const message =
        e.code === "claudeError" ? t.claudeError(e.message) : e.code === "advisorError" ? t.advisorError(e.message) : t[e.code];
      return Response.json({ error: message }, { status: statusFor(e.code) });
    }
    return Response.json({ error: e instanceof Error ? e.message : t.somethingWrong }, { status: 500 });
  }
}
