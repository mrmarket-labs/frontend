/** The feedback-and-waitlist form: shared by the screen and the route, so no server code lands in the browser bundle. */
export const WOULD_ACT = ["yes", "no", "maybe"] as const;
export type WouldAct = (typeof WOULD_ACT)[number];

export const TRUST = ["trackRecord", "clearerReasoning", "backtests", "editableTargets", "lowerFees"] as const;
export type Trust = (typeof TRUST)[number];

export const MAX_SHORT = 120;
export const MAX_LONG = 1000;

export interface FeedbackForm {
  email: string;
  name?: string;
  telegram?: string;
  liked?: string;
  missing?: string;
  wouldAct?: WouldAct;
  trust: Trust[];
  notes?: string;
}

/** What the read was, so a submission can be read next to the verdict it followed. No holdings, no addresses. */
export interface FeedbackContext {
  personaId: string;
  risk: string;
  cadence?: string;
  /** Order of magnitude of the on-chain total, e.g. "1k-10k". */
  sizeBucket: string;
}

export function sizeBucket(totalUsd: number): string {
  if (totalUsd < 100) return "<100";
  if (totalUsd < 1_000) return "100-1k";
  if (totalUsd < 10_000) return "1k-10k";
  if (totalUsd < 100_000) return "10k-100k";
  return "100k+";
}

const KEY = "diversify:waitlist";

export interface WaitlistSent {
  email: string;
  at: number;
}

export function loadWaitlistSent(): WaitlistSent | null {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as WaitlistSent) : null;
    return parsed && typeof parsed.email === "string" ? parsed : null;
  } catch {
    return null;
  }
}

export function saveWaitlistSent(sent: WaitlistSent): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(sent));
  } catch {}
}
