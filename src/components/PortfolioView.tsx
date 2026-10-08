"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/context";
import type { OutsideKind, OutsidePriced } from "@/lib/outside";
import type { PortfolioResponse } from "@/lib/types";
import { BTN_PRIMARY, BTN_QUIET, OUTSIDE_COLOR, OUTSIDE_COLORS, Ring, SectionLabel, Spinner, chartColor, pct, sliceBy, usd, type Slice } from "./ui";

const VISIBLE_ROWS = 12;

const daysSince = (at: number) => Math.floor((Date.now() - at) / 86_400_000);

/** The dominant number has to stay inside the donut's hole, whatever its length. */
function heroSize(text: string): string {
  if (text.length <= 6) return "text-hero lg:text-hero-lg tracking-[-1.5px]";
  if (text.length <= 8) return "text-display tracking-[-1px]";
  if (text.length <= 10) return "text-title tracking-[-0.5px]";
  return "text-wordmark";
}

export function PortfolioView({ portfolio, lastRead, scanning, onRescan, onAnalyze, outside, onOutside }: {
  portfolio: PortfolioResponse;
  lastRead: { at: number; personaId: string } | null;
  scanning: boolean;
  onRescan: () => void;
  onAnalyze: () => void;
  /** What the user stated they hold elsewhere, priced in dollars; empty when nothing is stated. */
  outside: OutsidePriced[];
  onOutside: () => void;
}) {
  const t = useT();
  const [picked, setPicked] = useState<string | null>(null);

  const { holdings, positions = [], totalUsd, errors } = portfolio;
  // The ring is everything the user holds: wallets in colour, money elsewhere in gray.
  const outsideUsd = outside.reduce((s, h) => s + h.valueUsd, 0);
  const whole = totalUsd + outsideUsd;
  const share = (v: number) => (whole > 0 ? (v / whole) * 100 : 0);
  const byKind = new Map<OutsideKind, number>();
  for (const h of outside) byKind.set(h.kind, (byKind.get(h.kind) ?? 0) + h.valueUsd);
  const outsideSlices: Slice[] = [...byKind.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([kind, v], i) => ({
      key: `outside:${kind}`,
      label: t.portfolio.elsewhereChip(t.outside.kinds[kind]),
      chip: t.portfolio.elsewhereChip(t.outside.kinds[kind]),
      color: OUTSIDE_COLORS[i % OUTSIDE_COLORS.length],
      pct: share(v),
      weight: v,
    }));
  const outsideColor = (kind: OutsideKind) => outsideSlices.find((s) => s.key === `outside:${kind}`)?.color ?? OUTSIDE_COLOR;
  const slices: Slice[] = [
    ...sliceBy(holdings, (h) => h.category, (h) => h.valueUsd, t.chart).map((s) => ({ ...s, pct: share(s.weight) })),
    ...outsideSlices,
  ];
  const cur = slices.find((s) => s.key === picked) ?? null;
  const chains = new Set(holdings.map((h) => h.chain)).size;
  const top = holdings.slice(0, VISIBLE_ROWS);
  const rest = holdings.slice(VISIBLE_ROWS);
  const restUsd = rest.reduce((s, h) => s + h.valueUsd, 0);
  const weight = (v: number) => pct(share(v));
  const notional = positions.reduce((s, p) => s + p.notionalUsd, 0);

  const lens = lastRead ? t.personas[lastRead.personaId as keyof typeof t.personas]?.short : null;
  const state = lastRead && lens ? t.portfolio.lastRead(t.portfolio.ago(daysSince(lastRead.at)), lens) : t.portfolio.nothingRead;

  const center = cur
    ? { label: cur.label, value: pct(cur.pct), sub: usd(cur.weight) }
    : {
        label: t.portfolio.totalValue,
        value: usd(whole),
        sub: outside.length > 0 ? t.portfolio.inWallets(usd(totalUsd)) : t.portfolio.positionsChains(holdings.length, chains),
      };

  return (
    <div className="flex flex-1 flex-col">
      <div className="hidden flex-wrap items-end justify-between gap-6 lg:flex">
        <div>
          <h1 className="font-display text-page-title leading-[1.1]">{t.portfolio.title}</h1>
          <p className="mt-1.5 text-label text-ink-3">{state}</p>
        </div>
        <div className="flex items-center gap-2.5">
          <button type="button" onClick={onRescan} disabled={scanning} className={`${BTN_QUIET} h-tap px-[18px]`}>
            {scanning && <Spinner />}
            {t.portfolio.rescan}
          </button>
          <button type="button" onClick={onAnalyze} disabled={holdings.length === 0} className={`${BTN_PRIMARY} h-tap rounded-input px-[22px] text-row`}>
            {t.portfolio.analyze} <span className="font-mono">→</span>
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
              aria-label={t.portfolio.donutLabel(slices.map((s) => `${s.label} ${pct(s.pct)}`).join(", "))}
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
                  {h.symbol} <span className="ml-1 text-meta text-ink-3">{t.chains[h.chain]}</span>
                </span>
                <span className="num min-w-[54px] text-right text-body text-ink-2">{weight(h.valueUsd)}</span>
                <span className="num min-w-[62px] text-right text-body">{usd(h.valueUsd)}</span>
              </li>
            ))}
            {rest.length > 0 && (
              <li className="flex items-center gap-3 border-b border-hairline py-[11px] text-ink-3">
                <span className="size-[7px] flex-none" />
                <span className="flex-1 text-body">{t.portfolio.smallerPositions(rest.length)}</span>
                <span className="num min-w-[54px] text-right text-body">{weight(restUsd)}</span>
                <span className="num min-w-[62px] text-right text-body">{usd(restUsd)}</span>
              </li>
            )}
          </ul>

          <table className="hidden w-full border-collapse text-left lg:table">
            <thead>
              <tr className="text-label text-ink-3">
                <th className="pb-3 font-normal">{t.portfolio.asset}</th>
                <th className="pb-3 font-normal">{t.portfolio.chain}</th>
                <th className="pb-3 text-right font-normal">{t.portfolio.weight}</th>
                <th className="pb-3 text-right font-normal">{t.portfolio.value}</th>
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
                  <td className="py-[13px] text-label text-ink-3">{t.chains[h.chain]}</td>
                  <td className="num py-[13px] text-right text-body text-ink-2">{weight(h.valueUsd)}</td>
                  <td className="num py-[13px] text-right text-body">{usd(h.valueUsd)}</td>
                </tr>
              ))}
              {rest.length > 0 && (
                <tr className="border-t border-hairline text-ink-3">
                  <td className="py-[13px] text-body" colSpan={2}>{t.portfolio.smallerPositions(rest.length)}</td>
                  <td className="num py-[13px] text-right text-body">{weight(restUsd)}</td>
                  <td className="num py-[13px] text-right text-body">{usd(restUsd)}</td>
                </tr>
              )}
            </tbody>
          </table>

          {positions.length > 0 && (
            <div className="mt-[26px]">
              <div className="flex items-baseline justify-between gap-3">
                <SectionLabel>{t.portfolio.leveragedPerps}</SectionLabel>
                <span className="num text-meta text-ink-3">{t.portfolio.notional(usd(notional), totalUsd > 0 ? (notional / totalUsd).toFixed(1) : null)}</span>
              </div>
              <ul className="mt-1">
                {positions.map((p) => (
                  <li key={`${p.venue}-${p.coin}`} className="flex items-center gap-3 border-b border-hairline py-[11px]">
                    <span className="min-w-0 flex-1 text-row">
                      {p.coin}{" "}
                      <span className="ml-1 text-meta text-ink-3">
                        <span className="num">{p.leverage}x</span> {t.portfolio.side[p.side]}
                        {p.liquidationPx ? <> · {t.portfolio.liquidatesAt} <span className="num">{usd(p.liquidationPx)}</span></> : null}
                      </span>
                    </span>
                    <span className="num text-right text-body text-ink-2">
                      {p.unrealizedPnlUsd >= 0 ? "+" : "−"}{usd(Math.abs(p.unrealizedPnlUsd))}
                    </span>
                    <span className="num min-w-[62px] text-right text-body">{usd(p.notionalUsd)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-meta text-ink-3">{t.portfolio.marginNote}</p>
            </div>
          )}

          {outside.length > 0 && (
            <div className="mt-[26px]">
              <div className="flex items-baseline justify-between gap-3">
                <SectionLabel>{t.portfolio.heldElsewhere}</SectionLabel>
                <button type="button" onClick={onOutside} className="text-meta text-ink-2 underline underline-offset-2 hover:text-ink">
                  {t.portfolio.edit}
                </button>
              </div>
              <ul className="mt-1">
                {outside.map((h) => (
                  <li key={h.id} className="flex items-center gap-3 border-b border-hairline py-[11px]">
                    <span className="size-[7px] flex-none rounded-full" style={{ background: outsideColor(h.kind) }} />
                    <span className="min-w-0 flex-1 truncate text-row">
                      {t.outside.kinds[h.kind]}
                      {h.note && <span className="ml-1 text-meta text-ink-3">{h.note}</span>}
                    </span>
                    <span className="num min-w-[54px] text-right text-body text-ink-2">{weight(h.valueUsd)}</span>
                    <span className="num min-w-[62px] text-right text-body">{usd(h.valueUsd)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-meta text-ink-3">{t.portfolio.elsewhereNote}</p>
            </div>
          )}

          {errors.length > 0 && (
            <ul className="mt-4 flex flex-col gap-1 text-meta text-ink-3">
              {errors.map((e, i) => (
                <li key={i}>{t.portfolio.couldNotRead(`${e.address.slice(0, 6)}…${e.address.slice(-4)}`, e.message)}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="flex-1 lg:hidden" />

      <div className="pt-6 lg:hidden">
        <button type="button" onClick={onAnalyze} disabled={holdings.length === 0} className={`${BTN_PRIMARY} h-[54px] w-full`}>
          {t.portfolio.analyze} <span className="font-mono">→</span>
        </button>
        <p className="mt-[11px] text-center text-meta text-ink-3">{state}</p>
      </div>
    </div>
  );
}
