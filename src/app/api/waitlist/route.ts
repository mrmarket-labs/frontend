import { z } from "zod/v4";
import { readSession } from "@/lib/auth";
import { dict, localeFromRequest } from "@/lib/i18n";
import { clientIp, hit, tooMany } from "@/lib/limits";
import { saveWaitlistEntry, waitlistConfigured } from "@/lib/waitlist";
import { MAX_LONG, MAX_SHORT, TRUST, WOULD_ACT } from "@/lib/waitlist-options";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const clean = (max: number) =>
  z
    .string()
    .max(max)
    .transform((s) => s.replace(/\s+/g, " ").trim())
    .optional();

const BodySchema = z.object({
  email: z.string().trim().toLowerCase().max(254),
  name: clean(MAX_SHORT),
  telegram: clean(MAX_SHORT),
  liked: clean(MAX_LONG),
  missing: clean(MAX_LONG),
  wouldAct: z.enum(WOULD_ACT).optional(),
  trust: z.array(z.enum(TRUST)).max(TRUST.length).default([]),
  notes: clean(MAX_LONG),
  context: z
    .object({
      personaId: z.string().max(40),
      risk: z.string().max(40),
      cadence: z.string().max(40).optional(),
      sizeBucket: z.string().max(20),
    })
    .optional(),
});

/** Feedback after a test analysis, plus the waitlist signup. One private JSON per submission. */
export async function POST(request: Request) {
  const locale = localeFromRequest(request);
  const t = dict(locale).api;
  if (!waitlistConfigured) return Response.json({ error: t.waitlistNotConfigured }, { status: 503 });
  const limit = await hit(`waitlist:${clientIp(request)}`, 5, 3600);
  if (!limit.ok) return tooMany(t.tooManyWaitlist, limit.retryAfterSec);

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: t.invalidRequest }, { status: 400 });
  if (!EMAIL.test(parsed.data.email)) return Response.json({ error: t.invalidEmail }, { status: 400 });

  const session = await readSession(request);
  const entry = {
    id: crypto.randomUUID().slice(0, 8),
    at: new Date().toISOString(),
    locale,
    wallet: session?.address,
    ...parsed.data,
  };
  // Empty optional strings are noise in the export.
  for (const key of ["name", "telegram", "liked", "missing", "notes"] as const) if (!entry[key]) delete entry[key];
  try {
    await saveWaitlistEntry(entry);
  } catch (e) {
    console.error("[waitlist] save failed:", e);
    return Response.json({ error: t.waitlistFailed }, { status: 502 });
  }
  return Response.json({ ok: true });
}
