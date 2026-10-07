import type { SignalId } from "../signals";

export type PushState = "unsupported" | "home-screen" | "denied" | "off" | "on";

export interface Channels {
  push: { publicKey: string } | null;
  email: boolean;
}

export const fetchChannels = (): Promise<Channels> => fetch("/api/notify").then((r) => r.json());

const supported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** iOS only allows web push once the site runs from the Home Screen. */
function needsHomeScreen(): boolean {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register("/sw.js");
}

export async function pushState(): Promise<PushState> {
  if (!supported()) return needsHomeScreen() ? "home-screen" : "unsupported";
  if (Notification.permission === "denied") return "denied";
  const sub = await (await registration()).pushManager.getSubscription();
  return sub ? "on" : "off";
}

function toKey(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function send(subscription: PushSubscription, on: Record<SignalId, boolean>): Promise<void> {
  const res = await fetch("/api/notify/push", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ subscription: subscription.toJSON(), on }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Request failed (${res.status})`);
}

/** Ask permission, subscribe this device, and tell the server what it follows. */
export async function enablePush(publicKey: string, on: Record<SignalId, boolean>): Promise<PushState> {
  if (!supported()) return needsHomeScreen() ? "home-screen" : "unsupported";
  const reg = await registration();
  if ((await Notification.requestPermission()) !== "granted") return "denied";
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(publicKey) }));
  await send(sub, on);
  return "on";
}

/** Keep the server's copy of what this device follows in step with the toggles. */
export async function syncPush(on: Record<SignalId, boolean>): Promise<void> {
  if (!supported()) return;
  const sub = await (await registration()).pushManager.getSubscription();
  if (sub) await send(sub, on);
}

export async function disablePush(): Promise<void> {
  if (!supported()) return;
  const sub = await (await registration()).pushManager.getSubscription();
  if (!sub) return;
  await fetch("/api/notify/push", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => undefined);
  await sub.unsubscribe();
}

export async function subscribeEmail(email: string, on: Record<SignalId, boolean>): Promise<{ confirmed: boolean }> {
  const res = await fetch("/api/notify/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, on }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

export async function unsubscribeEmail(email: string): Promise<void> {
  await fetch("/api/notify/email", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
}
