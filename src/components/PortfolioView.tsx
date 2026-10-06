"use client";

import { useState } from "react";
import { getPersona } from "@/lib/personas";
import type { PortfolioResponse } from "@/lib/types";
import { BTN_PRIMARY, BTN_QUIET, CHAIN_LABELS, Ring, SectionLabel, Spinner, chartColor, pct, sliceBy, usd, type ChartKey } from "./ui";

const VISIBLE_ROWS = 12;

function ago(at: number): string {
  const days = Math.floor((Date.now() - at) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
}

/** The dominant number has to stay inside the donut's hole, whatever its length. */
function heroSize(text: string): string {
  if (text.length <= 6) return "text-hero lg:text-hero-lg tracking-[-1.5px]";
  if (text.length <= 8) return "text-display tracking-[-1px]";
  if (text.length <= 10) return "text-title tracking-[-0.5px]";
  return "text-wordmark";
}

export function PortfolioView({ portfolio, lastRead, scanning, onRescan, onAnalyze }: {
  portfolio: PortfolioResponse;
  lastRead: { at: number; personaId: string } | null;
  scanning: boolean;
  onRescan: () => void;
  onAnalyze: () => void;
}) {
  const [picked, setPicked] = useState<ChartKey | null>(null);

  const { holdings, positions = [], totalUsd, errors } = portfolio;
  const slices = sliceBy(holdings, (h) => h.category, (h) => h.valueUsd);
  const cur = slices.find((s) => s.key === picked) ?? null;
  const chains = new Set(holdings.map((h) => h.chain)).size;
  const top = holdings.slice(0, VISIBLE_ROWS);
  const rest = holdings.slice(VISIBLE_ROWS);
  const restUsd = rest.reduce((s, h) => s + h.valueUsd, 0);
  const weight = (v: number) => pct(totalUsd > 0 ? (v / totalUsd) * 100 : 0);
  const notional = positions.reduce((s, p) => s + p.notionalUsd, 0);

  const lens = lastRead ? getPersona(lastRead.personaId)?.name.split(" ").at(-1) : null;
  const state = lastRead && lens ? `Last read ${ago(lastRead.at)}, through ${lens}’s lens.` : "Nothing read yet. Pick a lens to get a verdict.";

  const center = cur
    ? { label: cur.label, value: pct(cur.pct), sub: usd(cur.weight) }
    : {
        label: "Total value",
        value: usd(totalUsd),
        sub: `${holdings.length} position${holdings.length === 1 ? "" : "s"} · ${chains} chain${chains === 1 ? "" : "s"}`,
      };

  return (
    <div className="flex flex-1 flex-col">
      <div className="hidden flex-wrap items-end justify-between gap-6 lg:flex">
        <div>
          <h1 className="font-display text-page-title leading-[1.1]">Portfolio</h1>
          <p className="mt-1.5 text-label text-ink-3">{state}</p>
        </div>
        <div className="flex items-center gap-2.5">
          <button type="button" onClick={onRescan} disabled={scanning} className={`${BTN_QUIET} h-tap px-[18px]`}>
            {scanning && <Spinner />}
            Rescan
          </button>
          <button type="button" onClick={onAnalyze} disabled={holdings.length === 0} className={`${BTN_PRIMARY} h-tap rounded-input px-[22px] text-row`}>
            Analyze <span className="font-mono">→</span>
          </button>
        </div>
      </div>

      <div className="mt-[22px] flex flex-wrap items-start gap-x-12 gap-y-[30px] lg:mt-[34px]">
        <div className="min-w-0 flex-[0_1_360px] max-lg:flex-auto max-lg:basis-full">
          <div className="relative flex justify-center">
            <svg
              viewBox="0 0 300 300"
              role="img"
              className="size-[252px] lg:size-[300px]"
              aria-label={`Allocation donut: ${slices.map((s) => `${s.label} ${pct(s.pct)}`).join(", ") || "no holdings"}.`}
            >
              <g transform="rotate(-90 150 150)" fill="none">
                <Ring c={150} r={104} width={34} slices={slices} picked={cur ? picked : null} />
              </g>
            </svg>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <div className="text-meta text-ink-3">{center.label}</div>
              <div className={`num mt-1.5 leading-none ${heroSize(center.value)}`}>{center.value}</div>
              <div className="mt-1.5 text-meta text-ink-2">{center.sub}</div>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap justify-center gap-x-[7px] gap-y-3">
            {slices.map((s) => (
              <button
                key={s.key}
                type="button"
                aria-pressed={picked === s.key}
                onClick={() => setPicked(picked === s.key ? null : s.key)}
                className={`relative flex h-8 items-center gap-[7px] rounded-pill px-3 text-meta transition-colors before:absolute before:inset-x-0 before:-inset-y-1.5 ${picked === s.key ? "bg-surface-raised text-ink" : "bg-surface-track text-ink-2"}`}
              >
                <span className="size-[7px] rounded-full" style={{ background: s.color }} />
                {s.chip}
              </button>
            ))}
          </div>
        </div>

        <div className="min-w-0 flex-[999_1_420px]">
          {/* Rows on a phone, a table once there is width for four columns. */}
          <ul className="lg:hidden">
            {top.map((h) => (
              <li key={`${h.address}-${h.chain}-${h.symbol}`} className="flex items-center gap-3 border-b border-hairline py-[11px]">
                <span className="size-[7px] flex-none rounded-full" style={{ background: chartColor(h.category) }} />
                <span className="min-w-0 flex-1 truncate text-row">
                  {h.symbol} <span className="ml-1 text-meta text-ink-3">{CHAIN_LABELS[h.chain]}</span>
                </span>
                <span className="num min-w-[54px] text-right text-body text-ink-2">{weight(h.valueUsd)}</span>
                <span className="num min-w-[62px] text-right text-body">{usd(h.valueUsd)}</span>
              </li>
            ))}
            {rest.length > 0 && (
              <li className="flex items-center gap-3 border-b border-hairline py-[11px] text-ink-3">
                <span className="size-[7px] flex-none" />
                <span className="flex-1 text-body">+ {rest.length} smaller positions</span>
                <span className="num min-w-[54px] text-right text-body">{weight(restUsd)}</span>
                <span className="num min-w-[62px] text-right text-body">{usd(restUsd)}</span>
              </li>
            )}
          </ul>

          <table className="hidden w-full border-collapse text-left lg:table">
            <thead>
              <tr className="text-label text-ink-3">
                <th className="pb-3 font-normal">Asset</th>
                <th className="pb-3 font-normal">Chain</th>
                <th className="pb-3 text-right font-normal">Weight</th>
                <th className="pb-3 text-right font-normal">Value</th>
              </tr>
            </thead>
            <tbody>
              {top.map((h) => (
                <tr key={`${h.address}-${h.chain}-${h.symbol}`} className="border-t border-hairline">
                  <td className="py-[13px] text-row">
                    <span className="inline-flex items-center gap-2.5">
                      <span className="size-[7px] rounded-full" style={{ background: chartColor(h.category) }} />
                      {h.symbol}
                    </span>
                  </td>
                  <td className="py-[13px] text-label text-ink-3">{CHAIN_LABELS[h.chain]}</td>
                  <td className="num py-[13px] text-right text-body text-ink-2">{weight(h.valueUsd)}</td>
                  <td className="num py-[13px] text-right text-body">{usd(h.valueUsd)}</td>
                </tr>
              ))}
              {rest.length > 0 && (
                <tr className="border-t border-hairline text-ink-3">
                  <td className="py-[13px] text-body" colSpan={2}>+ {rest.length} smaller positions</td>
                  <td className="num py-[13px] text-right text-body">{weight(restUsd)}</td>
                  <td className="num py-[13px] text-right text-body">{usd(restUsd)}</td>
                </tr>
              )}
            </tbody>
          </table>

          {positions.length > 0 && (
            <div className="mt-[26px]">
              <div className="flex items-baseline justify-between gap-3">
                <SectionLabel>Leveraged perps</SectionLabel>
                <span className="num text-meta text-ink-3">
                  {usd(notional)} notional{totalUsd > 0 ? ` · ${(notional / totalUsd).toFixed(1)}x net worth` : ""}
                </span>
              </div>
              <ul className="mt-1">
                {positions.map((p) => (
                  <li key={`${p.venue}-${p.coin}`} className="flex items-center gap-3 border-b border-hairline py-[11px]">
                    <span className="min-w-0 flex-1 text-row">
                      {p.coin}{" "}
                      <span className="ml-1 text-meta text-ink-3">
                        <span className="num">{p.leverage}x</span> {p.side}
                        {p.liquidationPx ? <> · liquidates at <span className="num">{usd(p.liquidationPx)}</span></> : null}
                      </span>
                    </span>
                    <span className="num text-right text-body text-ink-2">
                      {p.unrealizedPnlUsd >= 0 ? "+" : "−"}{usd(Math.abs(p.unrealizedPnlUsd))}
                    </span>
                    <span className="num min-w-[62px] text-right text-body">{usd(p.notionalUsd)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-meta text-ink-3">Margin is already counted above; this is extra exposure on top.</p>
            </div>
          )}

          {errors.length > 0 && (
            <ul className="mt-4 flex flex-col gap-1 text-meta text-ink-3">
              {errors.map((e, i) => (
                <li key={i}>
                  <span className="num">{e.address.slice(0, 6)}…{e.address.slice(-4)}</span> could not be read: {e.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="flex-1 lg:hidden" />

      <div className="pt-6 lg:hidden">
        <button type="button" onClick={onAnalyze} disabled={holdings.length === 0} className={`${BTN_PRIMARY} h-[54px] w-full`}>
          Analyze <span className="font-mono">→</span>
        </button>
        <p className="mt-[11px] text-center text-meta text-ink-3">{state}</p>
      </div>
    </div>
  );
}
