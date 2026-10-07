import type { Locale } from "../i18n";
import { recordDelete, recordGet, recordSet, setAdd, setMembers, setRemove } from "../limits";
import { SIGNALS, type SignalId, type SignalStatus } from "../signals";

export type Channel = "push" | "email";

export interface PushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** One device (push) or one address (email), and the signals it follows. */
export interface Subscriber {
  id: string;
  channel: Channel;
  on: Record<SignalId, boolean>;
  locale: Locale;
  createdAt: string;
  push?: PushSubscription;
  email?: string;
  /** Email only: set once the confirmation link was opened. */
  confirmed?: boolean;
  /** Last status we told them about, so each crossing is sent once and re-arms when it clears. */
  state: Partial<Record<SignalId, "fired" | "quiet">>;
}

const KEY = (id: string) => `notify:sub:${id}`;
const INDEX = "notify:subs";

const IDS = new Set<string>(SIGNALS.map((s) => s.id));

export async function subscriberId(channel: Channel, handle: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${channel}:${handle}`));
  return `${channel}_${Buffer.from(digest).toString("base64url").slice(0, 22)}`;
}

/** Keep only known signal ids, defaulting the rest to off. */
export function sanitizeOn(input: unknown): Record<SignalId, boolean> {
  const on = Object.fromEntries(SIGNALS.map((s) => [s.id, false])) as Record<SignalId, boolean>;
  if (input && typeof input === "object") {
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) if (IDS.has(k)) on[k as SignalId] = v === true;
  }
  return on;
}

/** Statuses as of now, so a new subscriber only hears about crossings that happen after they joined. */
export function snapshotState(readings: { id: SignalId; status: SignalStatus }[]): Subscriber["state"] {
  return Object.fromEntries(readings.map((r) => [r.id, r.status === "fired" ? "fired" : "quiet"]));
}

export const getSubscriber = (id: string) => recordGet<Subscriber>(KEY(id));

export async function putSubscriber(sub: Subscriber): Promise<void> {
  await recordSet(KEY(sub.id), sub);
  await setAdd(INDEX, sub.id);
}

export async function deleteSubscriber(id: string): Promise<void> {
  await recordDelete(KEY(id));
  await setRemove(INDEX, id);
}

export async function allSubscribers(): Promise<Subscriber[]> {
  const ids = await setMembers(INDEX);
  const subs = await Promise.all(ids.map((id) => getSubscriber(id)));
  return subs.filter((s): s is Subscriber => s !== null);
}
