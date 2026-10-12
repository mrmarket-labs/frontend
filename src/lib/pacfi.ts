import { cached, getJson } from "./http";

const INDICATORS_URL = (process.env.INDICATORS_URL || "").replace(/\/$/, "");
const INDICATORS_TOKEN = process.env.INDICATORS_API_TOKEN || "";

/**
 * The PACFI methodology version this site shows, asked for explicitly so a change to indicators'
 * default never changes what the site reads. v1.0 is research's fitted composite.
 */
export const PACFI_VERSION = "v1.0";

/** PACFI updates once a day; the reading only needs refreshing a few times an hour. */
const TTL_MS = 15 * 60_000;

export type PacfiGroup = "Valuation" | "Stablecoin liquidity" | "Trend" | "Participation" | "Volatility" | "Options positioning";

/** PACFI as served by mrmarket-labs/indicators (`GET /api/pacfi?version=…`). Served to the browser by `/api/pacfi`. */
export interface Pacfi {
  version: string;
  /** ISO date (YYYY-MM-DD) of the latest reading. */
  asOf: string;
  /**
   * Unbounded; higher is frothier. v1.0 is the fitted prediction of BTC's maximum loss below entry over
   * the next 30–180 days, in standardised units; for v0.1, 0 is the components' own historical average.
   */
  pacfi: number;
  /** Constituents available on `asOf`; a fitted version is only defined when all are present. */
  components: { present: number; total: number };
  /** Each group's contribution. They sum to `pacfi` for v0.1 and to `pacfi - intercept` for v1.0. */
  groups: Record<PacfiGroup, number | null>;
  /** The fitted intercept; only on fitted versions (v1.0 onward). */
  intercept?: number;
  /** Daily, oldest first. `live` days were recorded on the day; the rest were computed afterwards. */
  history: { date: string; pacfi: number; live: boolean }[];
}

export const pacfiConfigured = Boolean(INDICATORS_URL && INDICATORS_TOKEN);

export function getPacfi(version = PACFI_VERSION): Promise<Pacfi> {
  if (!pacfiConfigured) return Promise.reject(new Error("PACFI isn't set up on this server."));
  return cached(`pacfi:${version}`, TTL_MS, () =>
    getJson<Pacfi>(`${INDICATORS_URL}/api/pacfi?version=${encodeURIComponent(version)}`, {
      headers: { authorization: `Bearer ${INDICATORS_TOKEN}` },
    }),
  );
}
