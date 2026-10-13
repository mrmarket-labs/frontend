import { sendGAEvent } from "@next/third-parties/google";

/** GA4 measurement id ("G-…"); without it nothing is loaded or sent. */
export const GA_ID = process.env.NEXT_PUBLIC_GA_ID;

/**
 * The funnel steps worth counting. The page is one route with views, so page views alone
 * would show nothing past the landing. Never send addresses, emails or amounts.
 */
export type AnalyticsEvent = "wallet_connected" | "address_watched" | "signed_in" | "analysis_completed" | "waitlist_joined";

/* --- Consent ----------------------------------------------------------------
   GA sets cookies, so it loads only after the visitor says yes, and the answer can be changed
   from the footer at any time. No answer yet means no analytics. */

export type Consent = "granted" | "denied";

const KEY = "diversify:analytics-consent";
const OPEN_EVENT = "diversify:consent-open";

export function loadConsent(): Consent | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === "granted" || raw === "denied" ? raw : null;
  } catch {
    return null;
  }
}

export function saveConsent(consent: Consent): void {
  try {
    localStorage.setItem(KEY, consent);
  } catch {}
  if (!GA_ID) return;
  (window as unknown as Record<string, unknown>)[`ga-disable-${GA_ID}`] = consent === "denied";
  if (consent === "denied") {
    // The flag above stops a tag that already loaded this visit; drop the cookies it set.
    for (const name of document.cookie.split(";").map((c) => c.split("=")[0].trim())) {
      if (name === "_ga" || name.startsWith("_ga_")) {
        const domain = location.hostname.split(".").slice(-2).join(".");
        document.cookie = `${name}=; path=/; max-age=0`;
        document.cookie = `${name}=; path=/; max-age=0; domain=.${domain}`;
      }
    }
  }
}

/** Show the consent banner again (the footer's "Cookie settings"). */
export function openConsent(): void {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

export function onConsentOpen(listener: () => void): () => void {
  window.addEventListener(OPEN_EVENT, listener);
  return () => window.removeEventListener(OPEN_EVENT, listener);
}

export function track(event: AnalyticsEvent, params: Record<string, string | number | boolean> = {}): void {
  if (!GA_ID || typeof window === "undefined" || loadConsent() !== "granted") return;
  try {
    sendGAEvent("event", event, params);
  } catch {}
}
