"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/context";
import {
  MAX_NOTE_LENGTH,
  MAX_OUTSIDE,
  OUTSIDE_KINDS,
  formatAmount,
  isFiat,
  unitsFor,
  valueOf,
  type Fiat,
  type OutsideHolding,
  type OutsideKind,
  type Rates,
  type Unit,
} from "@/lib/outside";
import { BTN_PRIMARY, BTN_TONAL, SectionLabel, Spinner, pct, usd } from "./ui";

const INPUT = "w-full rounded-input bg-surface-input px-3 text-body outline-none placeholder:text-ink-3 focus-visible:outline-2";

/** "20000", "20,000", "20k", "1.5m" → a number, or null. */
function parseAmount(text: string): number | null {
  const m = text.trim().toLowerCase().replace(/[\s,]/g, "").match(/^(\d*\.?\d+)([km])?$/);
  if (!m) return null;
  const n = Number(m[1]) * (m[2] === "k" ? 1e3 : m[2] === "m" ? 1e6 : 1);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);

/**
 * The step between portfolio and analyze: money the app cannot see. Amounts are kept as stated
 * (euros, ounces' worth, coins) and priced in dollars with the rates the page fetched.
 */
export function OutsideView({ items, onChange, rates, ratesError, onRetryRates, onChainUsd, onContinue }: {
  items: OutsideHolding[];
  onChange: (items: OutsideHolding[]) => void;
  /** USD per unit; null while loading or when the fetch failed. */
  rates: Rates | null;
  ratesError: boolean;
  onRetryRates: () => void;
  onChainUsd: number;
  onContinue: () => void;
}) {
  const t = useT();
  const lastFiat = ([...items].reverse().find((h) => isFiat(h.unit))?.unit as Fiat | undefined) ?? "USD";
  const [kind, setKind] = useState<OutsideKind>("cash");
  const [unit, setUnit] = useState<Unit>(lastFiat);
  const [amountText, setAmountText] = useState("");
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const value = (h: OutsideHolding) => valueOf(h, rates ?? {});
  const priced = items.map((h) => ({ h, v: value(h) }));
  const total = priced.reduce((s, { v }) => s + (v ?? 0), 0);
  const unpriced = priced.some(({ v }) => v == null);
  const whole = onChainUsd + total;

  function pickKind(next: OutsideKind) {
    setKind(next);
    const allowed = unitsFor(next);
    // Coins for the coin kinds, otherwise the fiat the user has been using.
    if (next === "bitcoin") setUnit("BTC");
    else if (next === "ethereum") setUnit("ETH");
    else if (!allowed.includes(unit)) setUnit(lastFiat);
  }

  function add() {
    const amount = parseAmount(amountText);
    if (amount == null) return setFormError(t.outside.amountInvalid);
    const trimmed = note.trim().slice(0, MAX_NOTE_LENGTH);
    onChange([...items, { id: newId(), kind, amount, unit, ...(trimmed ? { note: trimmed } : {}) }]);
    setAmountText("");
    setNote("");
    setFormError(null);
  }

  // Wait for rates, but never strand the user on a rate outage: the analysis fetches them again.
  const canContinue = !unpriced || ratesError;

  return (
    <div className="flex w-full max-w-[640px] flex-1 flex-col">
      <h1 className="font-display text-display leading-[1.05] lg:text-page-title">
        {t.outside.titleLead}<span className="text-ink-2 italic">{t.outside.titleTail}</span>
      </h1>
      <p className="mt-2 text-label leading-normal text-ink-2">{t.outside.intro}</p>

      {items.length === 0 ? (
        <p className="mt-5 text-body leading-normal text-ink-3">{t.outside.empty}</p>
      ) : (
        <ul className="mt-5">
          {priced.map(({ h, v }) => (
            <li key={h.id} className="flex items-center gap-3 border-b border-hairline py-[7px]">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-row">{t.outside.kinds[h.kind]}</span>
                <span className="block truncate text-meta text-ink-3">
                  <span className="num">{formatAmount(h.amount, h.unit)}</span>
                  {h.note ? ` · ${h.note}` : ""}
                </span>
              </span>
              <span className="num min-w-[72px] text-right text-body">
                {v != null ? usd(v) : rates == null && !ratesError ? "…" : <span className="text-ink-3">{t.outside.rateMissing}</span>}
              </span>
              <button
                type="button"
                aria-label={t.outside.remove(t.outside.kinds[h.kind])}
                onClick={() => onChange(items.filter((x) => x.id !== h.id))}
                className="-mr-3 flex size-tap flex-none items-center justify-center font-mono text-row text-ink-3 hover:text-ink"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {items.length < MAX_OUTSIDE && (
        <div className="mt-5 rounded-card-sm bg-surface p-4">
          <SectionLabel>{t.outside.what}</SectionLabel>
          <div role="group" aria-label={t.outside.what} className="mt-2 grid grid-cols-3 gap-1.5">
            {OUTSIDE_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={k === kind}
                onClick={() => pickKind(k)}
                className={`min-h-tap rounded-input px-2 text-label leading-tight transition-colors ${k === kind ? "bg-ink text-ground" : "bg-surface-input text-ink-2 hover:text-ink"}`}
              >
                {t.outside.kinds[k]}
              </button>
            ))}
          </div>

          <div className="mt-3.5 flex gap-2">
            <label className="block min-w-0 flex-1">
              <span className="text-meta text-ink-3">{t.outside.howMuch}</span>
              <input
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && add()}
                inputMode="decimal"
                autoComplete="off"
                placeholder={unit === "BTC" || unit === "ETH" ? "0.5" : "20,000"}
                className={`${INPUT} num mt-1 h-tap`}
              />
            </label>
            <label className="block w-[108px] flex-none">
              <span className="text-meta text-ink-3">{t.outside.unit}</span>
              <span className="relative mt-1 block">
                <select
                  value={unit}
                  onChange={(e) => setUnit(e.target.value as Unit)}
                  className={`${INPUT} num h-tap appearance-none pr-8`}
                >
                  {unitsFor(kind).map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
                <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center font-mono text-meta text-ink-3">▾</span>
              </span>
            </label>
          </div>

          <label className="mt-3 block">
            <span className="text-meta text-ink-3">{t.outside.note}</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
              maxLength={MAX_NOTE_LENGTH}
              placeholder={t.outside.notePlaceholder[kind]}
              className={`${INPUT} mt-1 h-tap`}
            />
          </label>

          <button type="button" onClick={add} className={`${BTN_TONAL} mt-3 h-tap w-full rounded-input`}>
            {t.outside.add}
          </button>
          {formError && <p role="alert" className="mt-2 text-meta text-risk">{formError}</p>}
        </div>
      )}

      {items.length > 0 && (
        <div className="mt-5 flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <SectionLabel>{t.outside.heldElsewhere}</SectionLabel>
            <span className="num text-row">{unpriced ? "…" : usd(total)}</span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <SectionLabel>{t.outside.onChain}</SectionLabel>
            <span className="num text-row text-ink-2">{usd(onChainUsd)}</span>
          </div>
          {!unpriced && whole > 0 && <p className="text-meta leading-normal text-ink-3">{t.outside.shareOfAll(pct((onChainUsd / whole) * 100, 0))}</p>}
          {rates == null && !ratesError && (
            <p className="flex items-center gap-2 text-meta text-ink-3">
              <Spinner /> {t.outside.ratesLoading}
            </p>
          )}
          {ratesError && unpriced && (
            <p role="alert" className="text-meta leading-normal text-risk">
              {t.outside.ratesFailed}{" "}
              <button type="button" onClick={onRetryRates} className="underline underline-offset-2">
                {t.outside.retry}
              </button>
            </p>
          )}
        </div>
      )}

      <div className="min-h-[26px] flex-1" />

      <div>
        <button type="button" onClick={onContinue} disabled={!canContinue} className={`${BTN_PRIMARY} h-[52px] w-full`}>
          {items.length === 0 ? t.outside.continueEmpty : t.outside.continue}
        </button>
        <p className="mt-2.5 text-center text-meta text-ink-3">{t.outside.staysHere}</p>
      </div>
    </div>
  );
}
