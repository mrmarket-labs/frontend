import type { Category } from "./types";

/**
 * Money the app cannot see or move: bank cash, a brokerage account, gold, coins on an exchange or
 * in cold storage. The lens still counts it, so the on-chain targets balance the whole picture
 * rather than a sleeve of it.
 */
export const OUTSIDE_KINDS = ["cash", "stocks", "bonds", "gold", "realEstate", "bitcoin", "ethereum", "otherCrypto", "other"] as const;
export type OutsideKind = (typeof OUTSIDE_KINDS)[number];

export const FIATS = ["USD", "EUR", "GBP", "CHF", "CNY", "JPY"] as const;
export type Fiat = (typeof FIATS)[number];
/** What an amount can be stated in: a fiat currency, or coins for the two crypto kinds. */
export const UNITS = [...FIATS, "BTC", "ETH"] as const;
export type Unit = (typeof UNITS)[number];

/** USD per unit, from `/api/fx`. */
export type Rates = Partial<Record<Unit, number>>;

export interface OutsideHolding {
  id: string;
  kind: OutsideKind;
  amount: number;
  unit: Unit;
  /** Free text the user adds, e.g. "S&P 500 ETF" or "cold wallet". */
  note?: string;
}

/** An outside holding with its dollar value fixed at the moment of the read. */
export interface OutsidePriced extends OutsideHolding {
  valueUsd: number;
}

export const MAX_OUTSIDE = 30;
export const MAX_NOTE_LENGTH = 60;

/** Units the form offers for a kind: coins only where the kind is that coin. */
export function unitsFor(kind: OutsideKind): readonly Unit[] {
  if (kind === "bitcoin") return ["BTC", ...FIATS];
  if (kind === "ethereum") return ["ETH", ...FIATS];
  return FIATS;
}

export const isFiat = (unit: Unit): unit is Fiat => (FIATS as readonly string[]).includes(unit);

/** How a kind reads against the on-chain categories; null where no on-chain class matches. */
export const OUTSIDE_CATEGORY: Record<OutsideKind, Category | null> = {
  cash: "stablecoin",
  stocks: "tokenized-stock",
  bonds: null,
  gold: "tokenized-gold",
  realEstate: null,
  bitcoin: "bitcoin",
  ethereum: "ethereum",
  otherCrypto: "large-cap",
  other: null,
};

export function valueOf(h: OutsideHolding, rates: Rates): number | null {
  const rate = h.unit === "USD" ? 1 : rates[h.unit];
  return rate == null ? null : h.amount * rate;
}

/** Fix every holding's dollar value; holdings whose rate is missing are dropped. */
export function priceOutside(items: OutsideHolding[], rates: Rates): OutsidePriced[] {
  return items.flatMap((h) => {
    const valueUsd = valueOf(h, rates);
    return valueUsd == null ? [] : [{ ...h, valueUsd }];
  });
}

export const outsideTotal = (items: OutsidePriced[]) => items.reduce((s, h) => s + h.valueUsd, 0);

/** "€20,000", "CHF 5,000", "0.3 BTC": the amount as the user stated it. */
export function formatAmount(amount: number, unit: Unit): string {
  if (isFiat(unit))
    return amount.toLocaleString("en-US", { style: "currency", currency: unit, maximumFractionDigits: amount < 100 ? 2 : 0 });
  return `${amount.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${unit}`;
}

const KEY = "diversify:outside";

export function loadOutside(): OutsideHolding[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (h): h is OutsideHolding =>
        typeof h === "object" && h != null && typeof h.id === "string" && OUTSIDE_KINDS.includes(h.kind) && UNITS.includes(h.unit) && Number.isFinite(h.amount) && h.amount > 0,
    );
  } catch {
    return [];
  }
}

export function saveOutside(items: OutsideHolding[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {}
}
