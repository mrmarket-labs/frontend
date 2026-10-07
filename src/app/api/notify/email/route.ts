import { verifyToken } from "@/lib/auth";
import { dict, localeFromRequest } from "@/lib/i18n";
import { clientIp, hit, tooMany } from "@/lib/limits";
import { SITE_URL, emailConfigured, sendConfirmationEmail } from "@/lib/notify/deliver";
import { deleteSubscriber, getSubscriber, putSubscriber, sanitizeOn, snapshotState, subscriberId } from "@/lib/notify/store";
import { getSignals } from "@/lib/signal-readings";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Subscribe an address (sends a confirmation link), or update what a confirmed address follows. */
export async function POST(request: Request) {
  const locale = localeFromRequest(request);
  const t = dict(locale).api;
  if (!emailConfigured) return Response.json({ error: t.emailNotConfigured }, { status: 503 });
  const limit = await hit(`notify:email:${clientIp(request)}`, 5, 3600);
  if (!limit.ok) return tooMany(t.tooManySubscriptions, limit.retryAfterSec);

  const body = (await request.json().catch(() => null)) as { email?: unknown; on?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL.test(email) || email.length > 254) return Response.json({ error: t.invalidEmail }, { status: 400 });

  const id = await subscriberId("email", email);
  const existing = await getSubscriber(id);
  const sub = {
    id,
    channel: "email" as const,
    on: sanitizeOn(body!.on),
    locale,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    email,
    confirmed: existing?.confirmed ?? false,
    state: existing?.state ?? snapshotState((await getSignals().catch(() => ({ readings: [] }))).readings),
  };
  await putSubscriber(sub);
  if (!sub.confirmed) {
    try {
      await sendConfirmationEmail(sub);
    } catch (e) {
      console.error("[notify] confirmation email failed:", e);
      return Response.json({ error: t.emailSendFailed }, { status: 502 });
    }
  }
  return Response.json({ id, confirmed: sub.confirmed });
}

/** Links from the emails: confirm or unsubscribe, then land back on Signals. */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("t") ?? "";
  const payload = await verifyToken(token);
  const [action, id] = payload?.split("|") ?? [];
  const sub = id ? await getSubscriber(id) : null;
  if (!sub || sub.channel !== "email" || (action !== "confirm" && action !== "unsubscribe")) {
    return Response.redirect(`${SITE_URL}/?email=invalid#signals`, 303);
  }
  if (action === "confirm") await putSubscriber({ ...sub, confirmed: true });
  else await deleteSubscriber(sub.id);
  return Response.redirect(`${SITE_URL}/?email=${action === "confirm" ? "confirmed" : "stopped"}#signals`, 303);
}

export async function DELETE(request: Request) {
  const body = (await request.json().catch(() => null)) as { email?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL.test(email)) return Response.json({ error: dict(localeFromRequest(request)).api.invalidEmail }, { status: 400 });
  await deleteSubscriber(await subscriberId("email", email));
  return Response.json({ ok: true });
}
