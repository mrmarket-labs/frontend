import { z } from "zod/v4";
import { CATEGORY_LABELS } from "./classify";
import { cached } from "./http";
import type { Locale } from "./i18n";
import { VENUES, type Horizon, type RiskLevel } from "./options";
import type { OutsidePriced } from "./outside";
import type { Category, Holding, MarketSnapshot, PerpPosition } from "./types";

/**
 * Client for the private advisor service (mrmarket-labs/advisor), which owns the prompt, the
 * investable universe and the persona lenses. This file only knows the wire contract.
 */
const ADVISOR_URL = (process.env.ADVISOR_URL || "").replace(/\/$/, "");
const ADVISOR_TOKEN = process.env.ADVISOR_API_TOKEN || "";
export const advisorConfigured = Boolean(ADVISOR_URL && ADVISOR_TOKEN);

/** Response shape; mirrors `src/contract.ts` in the advisor repo. */
const CATEGORIES = Object.keys(CATEGORY_LABELS) as [Category, ...Category[]];
export const AdviceSchema = z.object({
  verdict: z.string(),
  diagnosis: z.string(),
  marketView: z.string(),
  personaTake: z.string(),
  wholePicture: z.string().nullable(),
  currentRiskScore: z.number().int(),
  targetRiskScore: z.number().int(),
  allocations: z.array(
    z.object({
      asset: z.string(),
      venue: z.enum(VENUES),
      instrument: z.string(),
      category: z.enum(CATEGORIES),
      targetPct: z.number(),
      role: z.enum(["defensive", "core", "growth", "speculative"]),
      rationale: z.string(),
    }),
  ),
  trims: z.array(z.object({ asset: z.string(), reason: z.string() })),
  risks: z.array(z.string()),
  executionTips: z.array(z.string()),
});
export type Advice = z.infer<typeof AdviceSchema>;

const AdviceResponseSchema = z.object({
  advice: AdviceSchema,
  promptVersion: z.number(),
  model: z.string(),
  usage: z.object({ inputTokens: z.number(), outputTokens: z.number() }),
});

export interface AdviceRequest {
  personaId: string;
  holdings: Holding[];
  positions: PerpPosition[];
  /** Money the app cannot move, priced in dollars at the time of the read. */
  outside: OutsidePriced[];
  risk: RiskLevel;
  horizon: Horizon;
  allowPerps: boolean;
  market: MarketSnapshot;
  /** Language for every free-text field; tickers and venue ids stay as given. */
  locale: Locale;
}

/** Codes the advise route maps to the user's language. The first eight are the advisor's own; the last two are ours. */
export type AdviceErrorCode =
  | "invalidRequest"
  | "unknownPersona"
  | "modelDeclined"
  | "adviceCutOff"
  | "unexpectedFormat"
  | "badApiKey"
  | "claudeRateLimited"
  | "claudeError"
  | "advisorNotConfigured"
  | "advisorError";
const ADVISOR_CODES: AdviceErrorCode[] = ["invalidRequest", "unknownPersona", "modelDeclined", "adviceCutOff", "unexpectedFormat", "badApiKey", "claudeRateLimited", "claudeError"];

export class AdviceError extends Error {
  constructor(
    public readonly code: AdviceErrorCode,
    message: string = code,
  ) {
    super(message);
  }
}

const headers = { authorization: `Bearer ${ADVISOR_TOKEN}`, "content-type": "application/json" };

/** The advisor's prompt version, refreshed every minute, so the cache key retires answers from an old prompt. */
export function getPromptVersion(): Promise<number | "unknown"> {
  return cached("advisor-version", 60_000, async () => {
    try {
      const res = await fetch(`${ADVISOR_URL}/api/advise`, { headers, signal: AbortSignal.timeout(5_000) });
      const body = (await res.json()) as { promptVersion?: unknown };
      return typeof body.promptVersion === "number" ? body.promptVersion : "unknown";
    } catch {
      return "unknown";
    }
  });
}

export async function requestAdvice(req: AdviceRequest): Promise<Advice> {
  if (!advisorConfigured) throw new AdviceError("advisorNotConfigured");
  let res: Response;
  try {
    res = await fetch(`${ADVISOR_URL}/api/advise`, { method: "POST", headers, body: JSON.stringify(req), signal: AbortSignal.timeout(290_000) });
  } catch (e) {
    throw new AdviceError("advisorError", e instanceof Error ? e.message : "advisor unreachable");
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = body as { error?: unknown; message?: unknown } | null;
    const code = ADVISOR_CODES.find((c) => c === err?.error);
    if (code) throw new AdviceError(code, typeof err?.message === "string" ? err.message : code);
    throw new AdviceError("advisorError", `advisor responded ${res.status}`);
  }
  const parsed = AdviceResponseSchema.safeParse(body);
  if (!parsed.success) throw new AdviceError("unexpectedFormat");
  return parsed.data.advice;
}
