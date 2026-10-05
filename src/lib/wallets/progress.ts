export interface StepProgress {
  status: "done";
  txId?: string;
  /** Marked done by hand (manual steps). */
  manual?: boolean;
  at: number;
}

export type Progress = Record<string, StepProgress>;

const KEY = "diversify:plan-progress";

export function loadProgress(): Progress {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Progress;
  } catch {
    return {};
  }
}

export function saveProgress(p: Progress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {}
}
