import type { Advice } from "./advisor";
import type { Horizon, RiskLevel } from "./options";
import type { Step } from "./plan";
import type { Trade } from "./rebalance";
import type { Holding } from "./types";

/** One advisor read, kept on file so the verdict tab survives a reload. */
export interface Verdict {
  advice: Advice;
  trades: Trade[];
  /** Holdings the plan was built from; the plan stays fixed while the portfolio view refreshes. */
  holdings: Holding[];
  steps: Step[];
  personaId: string;
  risk: RiskLevel;
  horizon: Horizon;
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
