import { sendGAEvent } from "@next/third-parties/google";

/** GA4 measurement id ("G-…"); without it nothing is loaded or sent. */
export const GA_ID = process.env.NEXT_PUBLIC_GA_ID;

/**
 * The funnel steps worth counting. The page is one route with views, so page views alone
 * would show nothing past the landing. Never send addresses, emails or amounts.
 */
export type AnalyticsEvent = "wallet_connected" | "address_watched" | "signed_in" | "analysis_completed" | "waitlist_joined";

export function track(event: AnalyticsEvent, params: Record<string, string | number | boolean> = {}): void {
  if (!GA_ID || typeof window === "undefined") return;
  try {
    sendGAEvent("event", event, params);
  } catch {}
}
