export type SignalId = "berk" | "cape" | "fng" | "w200" | "mvrv" | "dom" | "fund";

export type SignalStatus = "fired" | "close" | "quiet" | "unavailable";

/** `name`, `fires` and `crossed` are the English wording; the UI reads the dictionary by `id`. */
export interface SignalDef {
  id: SignalId;
  group: "markets" | "crypto";
  name: string;
  /** Reads after "fires": "above 85", "on a new high". */
  fires: string;
  /** Headline once it has fired. */
  crossed: string;
  /** Followed until the user says otherwise. */
  defaultOn: boolean;
}

/** Display order of the groups; their names live in the dictionary (`signals.groups`). */
export const SIGNAL_GROUPS: SignalDef["group"][] = ["markets", "crypto"];

export const SIGNALS: SignalDef[] = [
  { id: "berk", group: "markets", name: "Berkshire cash at a record", fires: "on a new high", crossed: "Berkshire's cash pile set a record", defaultOn: true },
  { id: "cape", group: "markets", name: "S&P 500 CAPE over 35", fires: "above 35", crossed: "S&P 500 CAPE crossed 35", defaultOn: false },
  { id: "fng", group: "crypto", name: "Fear & Greed over 85", fires: "above 85", crossed: "Fear & Greed crossed 85", defaultOn: true },
  { id: "w200", group: "crypto", name: "BTC far above its 200-week line", fires: "at +2σ", crossed: "BTC is 2σ above its 200-week line", defaultOn: true },
  { id: "mvrv", group: "crypto", name: "MVRV Z-score over 5", fires: "above 5", crossed: "MVRV Z-score crossed 5", defaultOn: true },
  { id: "dom", group: "crypto", name: "BTC dominance under 50%", fires: "below 50%", crossed: "BTC dominance fell under 50%", defaultOn: false },
  { id: "fund", group: "crypto", name: "Perp funding hot for a week", fires: "above 30% APR", crossed: "Perp funding has run hot for a week", defaultOn: false },
];

export interface SignalReading {
  id: SignalId;
  /** Current reading, formatted for display; null when the signal has no feed. */
  now: string | null;
  status: SignalStatus;
  /** ISO date (YYYY-MM-DD) of the crossing that put it in "fired", where history exists. */
  firedAt?: string;
}

export interface FiredEvent {
  id: SignalId;
  name: string;
  /** ISO date, YYYY-MM-DD. */
  date: string;
}

export interface SignalsResponse {
  asOf: string;
  readings: SignalReading[];
  /** Past firings, newest first. */
  fired: FiredEvent[];
}
