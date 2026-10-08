import type { Advice } from "./advisor";
import type { Locale } from "./i18n";
import type { Horizon, RiskLevel } from "./options";
import type { OutsidePriced } from "./outside";
import type { Step } from "./plan";
import type { Trade } from "./rebalance";
import type { Holding } from "./types";

/** One advisor read, kept on file so the verdict tab survives a reload. */
export interface Verdict {
  advice: Advice;
  trades: Trade[];
  /** Holdings the plan was built from; the plan stays fixed while the portfolio view refreshes. */
  holdings: Holding[];
  /** Money outside the app the read counted, priced at the time; absent on older verdicts. */
  outside?: OutsidePriced[];
  steps: Step[];
  personaId: string;
  risk: RiskLevel;
  horizon: Horizon;
  /** Language the advisor wrote in; verdicts saved before languages existed have none (English). */
  locale?: Locale;
  at: number;
}

const KEY = "diversify:verdict";

export function loadVerdict(): Verdict | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Verdict) : null;
  } catch {
    return null;
  }
}

export function saveVerdict(v: Verdict): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {}
}
