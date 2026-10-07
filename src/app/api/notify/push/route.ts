import { dict, localeFromRequest } from "@/lib/i18n";
import { clientIp, hit, tooMany } from "@/lib/limits";
import { pushConfigured } from "@/lib/notify/deliver";
import { deleteSubscriber, getSubscriber, putSubscriber, sanitizeOn, snapshotState, subscriberId, type PushSubscription } from "@/lib/notify/store";
import { getSignals } from "@/lib/signal-readings";

function validSubscription(v: unknown): v is PushSubscription {
  const s = v as PushSubscription | undefined;
  return Boolean(s && typeof s.endpoint === "string" && /^https:\/\//.test(s.endpoint) && s.endpoint.length < 2048 && s.keys && typeof s.keys.p256dh === "string" && typeof s.keys.auth === "string");
}

/** Subscribe this device, or update which signals it follows. */
export async function POST(request: Request) {
  const locale = localeFromRequest(request);
  const t = dict(locale).api;
  if (!pushConfigured) return Response.json({ error: t.pushNotConfigured }, { status: 503 });
  const limit = await hit(`notify:push:${clientIp(request)}`, 30, 3600);
  if (!limit.ok) return tooMany(t.tooManySubscriptions, limit.retryAfterSec);

  const body = (await request.json().catch(() => null)) as { subscription?: unknown; on?: unknown } | null;
  if (!body || !validSubscription(body.subscription)) return Response.json({ error: t.invalidRequest }, { status: 400 });

  const id = await subscriberId("push", body.subscription.endpoint);
  const existing = await getSubscriber(id);
  const state = existing?.state ?? snapshotState((await getSignals().catch(() => ({ readings: [] }))).readings);
  await putSubscriber({
    id,
    channel: "push",
    on: sanitizeOn(body.on),
    locale,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    push: { endpoint: body.subscription.endpoint, keys: { p256dh: body.subscription.keys.p256dh, auth: body.subscription.keys.auth } },
    state,
  });
  return Response.json({ id });
}

export async function DELETE(request: Request) {
  const body = (await request.json().catch(() => null)) as { endpoint?: unknown } | null;
  if (!body || typeof body.endpoint !== "string") return Response.json({ error: dict(localeFromRequest(request)).api.invalidRequest }, { status: 400 });
  await deleteSubscriber(await subscriberId("push", body.endpoint));
  return Response.json({ ok: true });
}
