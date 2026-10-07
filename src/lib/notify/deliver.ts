import webpush from "web-push";
import { signToken } from "../auth";
import { dict, type Locale } from "../i18n";
import { getSignals } from "../signal-readings";
import type { SignalId, SignalReading } from "../signals";
import { allSubscribers, deleteSubscriber, putSubscriber, type Subscriber } from "./store";

export const SITE_URL = (process.env.SITE_URL || "https://investlikebuffett.xyz").replace(/\/$/, "");
export const SIGNALS_URL = `${SITE_URL}/#signals`;

/* --- Push ------------------------------------------------------------------------ */

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || "";
export const pushConfigured = Boolean(VAPID_PUBLIC && VAPID_PRIVATE);
export const vapidPublicKey = VAPID_PUBLIC;

if (pushConfigured) webpush.setVapidDetails(process.env.VAPID_SUBJECT || `mailto:alerts@${new URL(SITE_URL).host}`, VAPID_PUBLIC, VAPID_PRIVATE);

export interface PushMessage {
  title: string;
  body: string;
  url: string;
  tag: string;
}

/** Returns false when the browser has dropped the subscription, so the caller can forget it. */
export async function sendPush(sub: Subscriber, message: PushMessage): Promise<boolean> {
  if (!sub.push) return false;
  try {
    await webpush.sendNotification(sub.push, JSON.stringify(message), { TTL: 24 * 3600, urgency: "normal" });
    return true;
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) return false;
    throw e;
  }
}

/* --- Email ----------------------------------------------------------------------- */

const RESEND_KEY = process.env.RESEND_API_KEY || "";
const FROM = process.env.NOTIFY_FROM || "Diversify <onboarding@resend.dev>";
export const emailConfigured = Boolean(RESEND_KEY);

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export async function sendEmail(to: string, subject: string, html: string, text: string): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${RESEND_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [to], subject, html, text }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Resend responded ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

export const emailActionLink = async (action: "confirm" | "unsubscribe", id: string) =>
  `${SITE_URL}/api/notify/email?t=${encodeURIComponent(await signToken(`${action}|${id}`))}`;

/** Plain, single-column email; the same words as the app, in the subscriber's language. */
function layout(locale: Locale, heading: string, lines: string[], cta: { label: string; url: string }, footer: string[]): { html: string; text: string } {
  const t = dict(locale);
  const html = `<!doctype html><html lang="${t.htmlLang}"><body style="margin:0;background:#0b0b0b;color:#f2f2f2;font:16px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif">
<div style="max-width:520px;margin:0 auto;padding:32px 24px">
<div style="font-size:22px;font-family:Georgia,serif">Diversify</div>
<h1 style="font-size:20px;font-weight:600;margin:28px 0 12px">${esc(heading)}</h1>
${lines.map((l) => `<p style="margin:0 0 10px;color:#d6d6d6">${esc(l)}</p>`).join("")}
<p style="margin:24px 0"><a href="${cta.url}" style="display:inline-block;background:#c8f171;color:#111;text-decoration:none;font-weight:600;padding:12px 18px;border-radius:10px">${esc(cta.label)}</a></p>
${footer.map((l) => `<p style="margin:0 0 6px;font-size:13px;color:#8a8a8a">${l}</p>`).join("")}
</div></body></html>`;
  const text = [heading, "", ...lines, "", `${cta.label}: ${cta.url}`, "", ...footer.map((l) => l.replace(/<[^>]+>/g, ""))].join("\n");
  return { html, text };
}

export async function sendConfirmationEmail(sub: Subscriber): Promise<void> {
  const t = dict(sub.locale).notify;
  const picked = Object.entries(sub.on)
    .filter(([, v]) => v)
    .map(([id]) => dict(sub.locale).signals.defs[id as SignalId].name);
  const { html, text } = layout(sub.locale, t.confirmHeading, [t.confirmBody, picked.length ? t.youPicked(picked.join(" · ")) : ""].filter(Boolean), { label: t.confirmButton, url: await emailActionLink("confirm", sub.id) }, [esc(t.ignoreIfNotYou)]);
  await sendEmail(sub.email!, t.confirmSubject, html, text);
}

async function sendFiredEmail(sub: Subscriber, fired: { id: SignalId; reading: SignalReading }[]): Promise<void> {
  const d = dict(sub.locale);
  const t = d.notify;
  const names = fired.map((f) => d.signals.defs[f.id].crossed);
  const lines = fired.map((f) => `${d.signals.defs[f.id].crossed} — ${d.signalsView.now(f.reading.now ?? "")}`);
  const unsubscribe = await emailActionLink("unsubscribe", sub.id);
  const { html, text } = layout(sub.locale, t.firedHeading(fired.length), [t.firedIntro, ...lines], { label: t.openSignals, url: SIGNALS_URL }, [
    esc(d.signalsView.information),
    `<a href="${unsubscribe}" style="color:#8a8a8a">${esc(t.unsubscribe)}</a>`,
  ]);
  await sendEmail(sub.email!, t.firedSubject(names[0], fired.length), html, text);
}

/* --- The daily job ---------------------------------------------------------------- */

export interface RunReport {
  subscribers: number;
  notified: number;
  dropped: number;
  errors: string[];
}

/**
 * Tell every subscriber about the signals they follow that crossed since we last looked.
 * Edge-triggered per subscriber: a firing is sent once, and re-arms once the signal clears.
 */
export async function notifyAll(): Promise<RunReport> {
  const { readings } = await getSignals();
  const subs = await allSubscribers();
  const report: RunReport = { subscribers: subs.length, notified: 0, dropped: 0, errors: [] };

  for (const sub of subs) {
    if (sub.channel === "email" && !sub.confirmed) continue;
    const fired = readings.filter((r) => r.status === "fired" && sub.on[r.id] && sub.state[r.id] !== "fired").map((r) => ({ id: r.id, reading: r }));
    const next: Subscriber["state"] = { ...sub.state };
    for (const r of readings) next[r.id] = r.status === "fired" ? "fired" : "quiet";
    if (fired.length === 0) {
      if (JSON.stringify(next) !== JSON.stringify(sub.state)) await putSubscriber({ ...sub, state: next });
      continue;
    }
    try {
      if (sub.channel === "push") {
        const d = dict(sub.locale);
        let alive = true;
        for (const f of fired) {
          alive = await sendPush(sub, {
            title: d.signals.defs[f.id].crossed,
            body: d.notify.pushBody(f.reading.now ?? ""),
            url: SIGNALS_URL,
            tag: `signal-${f.id}`,
          });
          if (!alive) break;
        }
        if (!alive) {
          await deleteSubscriber(sub.id);
          report.dropped++;
          continue;
        }
      } else {
        await sendFiredEmail(sub, fired);
      }
      await putSubscriber({ ...sub, state: next });
      report.notified++;
    } catch (e) {
      report.errors.push(`${sub.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return report;
}
