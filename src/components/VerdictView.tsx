"use client";

import { useState } from "react";
import type { Advice } from "@/lib/advisor";
import { useLocale, useT } from "@/lib/i18n/context";
import { OUTSIDE_CATEGORY, type OutsideKind, type OutsidePriced } from "@/lib/outside";
import { getPersona } from "@/lib/personas";
import type { Step, SwapStep } from "@/lib/plan";
import type { Verdict } from "@/lib/verdict";
import type { Progress } from "@/lib/wallets/progress";
import type { WalletsApi } from "@/lib/wallets/useWallets";
import { PlanView } from "./PlanView";
import { BTN_PRIMARY, BTN_QUIET, PageHeader, Ring, SectionLabel, chartColor, pct, shortDate, sliceBy, usd } from "./ui";

type Allocation = Advice["allocations"][number];

interface Target {
  asset: string;
  category: Allocation["category"];
  role: Allocation["role"];
  targetPct: number;
  via: string[];
  rationale: string[];
  /** Points of the portfolio this asset moves by, target minus today. */
  delta: number;
}

/** One row per canonical asset: the advisor may split an asset across venues (native BTC + cbBTC). */
function targetsOf(verdict: Verdict, via: (instrument: string, venue: string) => string, venues: Record<Allocation["venue"], string>): Target[] {
  const total = verdict.holdings.reduce((s, h) => s + h.valueUsd, 0) || 1;
  const today = (asset: string) =>
    (verdict.holdings.filter((h) => h.asset.toUpperCase() === asset.toUpperCase()).reduce((s, h) => s + h.valueUsd, 0) / total) * 100;
  const byAsset = new Map<string, Target>();
  for (const a of verdict.advice.allocations) {
    const key = a.asset.toUpperCase();
    const route = via(a.instrument, venues[a.venue]);
    const prev = byAsset.get(key);
    if (prev) byAsset.set(key, { ...prev, targetPct: prev.targetPct + a.targetPct, via: [...prev.via, route], rationale: [...prev.rationale, a.rationale] });
    else byAsset.set(key, { asset: a.asset, category: a.category, role: a.role, targetPct: a.targetPct, via: [route], rationale: [a.rationale], delta: 0 });
  }
  return [...byAsset.values()].map((t) => ({ ...t, delta: t.targetPct - today(t.asset) })).sort((a, b) => b.targetPct - a.targetPct);
}

/**
 * On-chain money next to everything stated outside the app, one bar and one row each. Kinds borrow
 * the chart colour of the on-chain class they stand in for; the rest sit in a neutral tone.
 */
function WholePicture({ onChainUsd, outside, note }: { onChainUsd: number; outside: OutsidePriced[]; note: string | null | undefined }) {
  const t = useT();
  const byKind = new Map<OutsideKind, number>();
  for (const h of outside) byKind.set(h.kind, (byKind.get(h.kind) ?? 0) + h.valueUsd);
  const whole = onChainUsd + outside.reduce((s, h) => s + h.valueUsd, 0) || 1;
  const rows = [
    { key: "wallets", label: t.verdict.inWallets, usd: onChainUsd, color: "var(--text)" },
    ...[...byKind.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([kind, value]) => {
        const category = OUTSIDE_CATEGORY[kind];
        return { key: kind, label: t.outside.kinds[kind], usd: value, color: category ? chartColor(category) : "var(--text-4)" };
      }),
  ].filter((r) => r.usd > 0);
  const share = (n: number) => (n / whole) * 100;

  return (
    <div className="mt-5 rounded-card-sm bg-surface p-4 lg:mt-6">
      <SectionLabel>{t.verdict.wholePicture}</SectionLabel>
      <p className="mt-1.5 text-body leading-normal text-ink-2">{t.verdict.onChainShare(usd(onChainUsd), pct(share(onChainUsd), 0))}</p>
      <div role="img" aria-label={t.verdict.wholeBarLabel(rows.map((r) => `${r.label} ${pct(share(r.usd), 0)}`).join(", "))} className="mt-3 flex h-2 gap-px overflow-hidden rounded-pill bg-surface-track">
        {rows.map((r) => (
          <span key={r.key} style={{ width: `${share(r.usd)}%`, background: r.color }} className="block h-full" />
        ))}
      </div>
      <ul className="mt-3 flex flex-col gap-[7px]">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-[9px]">
            <span className="size-[7px] flex-none rounded-full" style={{ background: r.color }} />
            <span className="min-w-0 flex-1 truncate text-label text-ink-2">{r.label}</span>
            <span className="num text-meta text-ink-3">{pct(share(r.usd), 0)}</span>
            <span className="num min-w-[72px] text-right text-body">{usd(r.usd)}</span>
          </li>
        ))}
      </ul>
      {note && <p className="mt-3 text-body leading-relaxed text-ink-2">{note}</p>}
    </div>
  );
}

function Delta({ points, hold, pts }: { points: number; hold: string; pts: (signed: string) => string }) {
  if (Math.abs(points) < 1) return <div className="text-meta text-ink-3">{hold}</div>;
  return <div className={`text-meta ${points > 0 ? "text-accent" : "text-warn"}`}>{pts(`${points > 0 ? "+" : "−"}${Math.abs(points).toFixed(0)}`)}</div>;
}

export function VerdictView({ verdict, wallets, progress, onReview, onMarkDone, onWallets, onAnalyze, onSignals }: {
  verdict: Verdict | null;
  wallets: WalletsApi;
  progress: Progress;
  onReview: (step: SwapStep) => void;
  onMarkDone: (step: Step) => void;
  /** Open the wallets screen (connect the wallet a swap needs). */
  onWallets: () => void;
  /** Open the analyze page: the first read, or "Run again". */
  onAnalyze: () => void;
  onSignals: () => void;
}) {
  const { locale, t } = useLocale();
  const [more, setMore] = useState(false);

  if (!verdict)
    return (
      <div>
        <PageHeader title={t.verdict.title} />
        <div className="mt-8 max-w-[26em] lg:mt-10">
          <h2 className="font-display text-display leading-[1.1]">{t.verdict.noneYet}</h2>
          <p className="mt-3 text-body leading-relaxed text-ink-2">{t.verdict.noneIntro}</p>
          <button type="button" onClick={onAnalyze} className={`${BTN_PRIMARY} mt-6 h-[52px] w-full lg:w-auto lg:px-7`}>
            {t.verdict.analyze} <span className="font-mono">→</span>
          </button>
        </div>
      </div>
    );

  const { advice, holdings } = verdict;
  const persona = getPersona(verdict.personaId);
  const personaName = t.personas[verdict.personaId as keyof typeof t.personas]?.name ?? persona?.name;
  const targets = targetsOf(verdict, t.verdict.via, t.venues);
  const heldAssets = new Set(holdings.filter((h) => h.valueUsd > 0).map((h) => h.asset.toUpperCase())).size;
  const outer = sliceBy(advice.allocations, (a) => a.category, (a) => a.targetPct, t.chart);
  const inner = sliceBy(holdings, (h) => h.category, (h) => h.valueUsd, t.chart);
  const describe = (slices: typeof outer) => slices.map((s) => `${s.label} ${t.verdict.percent(s.pct.toFixed(0))}`).join(", ");
  const ringLabel = t.verdict.ringLabel(describe(outer), describe(inner));
  // Claude wrote the prose in the language of the day; the chrome around it follows the switch.
  const otherLanguage = (verdict.locale ?? "en") !== locale;

  return (
    <div>
      <PageHeader
        title={t.verdict.title}
        sub={[personaName && t.verdict.throughLens(personaName), t.risk[verdict.risk], t.horizon[verdict.horizon], t.verdict.readOn(shortDate(verdict.at, t))]
          .filter(Boolean)
          .join(" · ")}
      >
        <button type="button" onClick={onAnalyze} className={`${BTN_QUIET} h-tap px-[18px]`}>
          {t.verdict.runAgain}
        </button>
      </PageHeader>
      {otherLanguage && <p className="mt-3 text-meta leading-normal text-ink-3">{t.verdict.otherLanguage}</p>}

      <div className="mt-5 lg:mt-8 lg:flex lg:flex-wrap lg:items-start lg:gap-gap-col">
        {/* The read */}
        <div className="min-w-0 lg:flex-[999_1_460px]">
          <h2 className="max-w-[19em] font-display text-display leading-[1.12]">{advice.verdict}</h2>
          <p className="mt-3.5 max-w-[36em] text-body leading-relaxed text-ink-2">{advice.diagnosis}</p>

          <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} className="mt-1 flex h-tap items-center gap-2 text-label text-ink-2 hover:text-ink">
            {t.verdict.moreReasoning} <span className="num">{more ? "−" : "+"}</span>
          </button>
          {more && (
            <div className="max-w-[36em] space-y-3 pb-2 text-body leading-relaxed text-ink-2">
              <p>{advice.marketView}</p>
              <p>{advice.personaTake}</p>
              <ul className="space-y-1.5">
                {targets.map((target) => (
                  <li key={target.asset}>
                    <span className="text-ink">{target.asset}</span> — {target.rationale.join(" ")}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <span className="text-label text-ink-3">{t.verdict.risk}</span>
            <span className={`num text-body ${advice.currentRiskScore > advice.targetRiskScore ? "text-warn" : ""}`}>{advice.currentRiskScore}/10</span>
            <span className="num text-meta text-rule">→</span>
            <span className="num text-body">{advice.targetRiskScore}/10</span>
            <span className="text-label text-ink-3">{t.verdict.ifYouFollow}</span>
          </div>

          {verdict.outside && verdict.outside.length > 0 && (
            <WholePicture onChainUsd={holdings.reduce((s, h) => s + h.valueUsd, 0)} outside={verdict.outside} note={advice.wholePicture} />
          )}

          <div className="mt-5 rounded-card bg-surface px-4 py-[18px] lg:mt-8 lg:flex lg:flex-wrap lg:items-center lg:gap-9 lg:rounded-none lg:bg-transparent lg:p-0">
            <div className="flex items-baseline justify-between lg:hidden">
              <SectionLabel>{t.verdict.nowVsTarget}</SectionLabel>
              <span className="text-meta text-ink-3">{t.verdict.innerRingToday}</span>
            </div>
            <div className="relative mt-2.5 flex justify-center lg:mt-0 lg:flex-none">
              <svg viewBox="0 0 240 240" role="img" aria-label={ringLabel} className="size-[208px] lg:size-[240px]">
                <g transform="rotate(-90 120 120)" fill="none">
                  <Ring c={120} r={98} width={22} slices={outer} />
                  <Ring c={120} r={66} width={18} slices={inner} opacity={0.45} />
                </g>
              </svg>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <div className="font-display text-page-title leading-none">{targets.length}</div>
                <div className="mt-[3px] text-meta text-ink-3">{t.verdict.holdingsFrom(targets.length, heldAssets)}</div>
              </div>
            </div>

            <div className="mt-3 flex min-w-0 flex-col gap-[13px] lg:mt-0 lg:flex-[999_1_240px]">
              <SectionLabel className="hidden lg:block">{t.verdict.nowVsTargetFull}</SectionLabel>
              {targets.map((target) => (
                <div key={target.asset} className="flex items-center gap-[11px]">
                  <span className="size-[9px] flex-none rounded-full" style={{ background: chartColor(target.category) }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-[7px]">
                      <span className="text-row">{target.asset}</span>
                      <span className="text-meta capitalize text-ink-3">{t.roles[target.role]}</span>
                    </div>
                    <div className="text-meta text-ink-4">{t.verdict.viaLine(target.via.join(" + "))}</div>
                  </div>
                  <div className="num flex-none text-right">
                    <div className="text-body">{pct(target.targetPct, 0)}</div>
                    <Delta points={target.delta} hold={t.verdict.hold} pts={t.verdict.pts} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* The plan */}
        <div className="mt-8 min-w-0 lg:mt-0 lg:flex-[1_1_420px] lg:rounded-card lg:bg-surface lg:px-[22px] lg:py-6">
          <div className="flex items-center gap-3">
            <h3 className="font-display text-title leading-[1.1]">{t.verdict.whatToDo}</h3>
            <span className="h-px flex-1 bg-accent lg:hidden" />
          </div>
          <PlanView verdict={verdict} wallets={wallets} progress={progress} onReview={onReview} onMarkDone={onMarkDone} onWallets={onWallets} />

          <div className="mt-[18px] rounded-card-sm bg-surface px-[15px] py-3.5 lg:mt-5 lg:rounded-none lg:border-t lg:border-hairline lg:bg-transparent lg:px-0 lg:pb-0 lg:pt-4">
            <SectionLabel>{t.verdict.beforeYouTrade}</SectionLabel>
            <ul className="mt-2.5 flex flex-col gap-[9px]">
              {advice.risks.map((r) => (
                <li key={r} className="flex items-start gap-[9px]">
                  <span className="mt-[6px] size-[5px] flex-none rounded-full bg-risk" />
                  <span className="text-meta leading-normal text-ink-2">{r}</span>
                </li>
              ))}
              {advice.executionTips.map((r) => (
                <li key={r} className="flex items-start gap-[9px]">
                  <span className="mt-[6px] size-[5px] flex-none rounded-full bg-accent" />
                  <span className="text-meta leading-normal text-ink-2">{r}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-card bg-surface-live-2 px-4 py-[18px] lg:hidden">
        <SectionLabel>{t.verdict.andAfterThat}</SectionLabel>
        <h2 className="mt-2 font-display text-title leading-[1.12]">
          {t.verdict.nothingLead} <span className="block italic text-accent">{t.verdict.nothingTail}</span>
        </h2>
        <p className="mt-2.5 text-label leading-normal text-accent-text">{t.verdict.staysOnFile}</p>
        <button type="button" onClick={onSignals} className={`${BTN_PRIMARY} mt-3.5 h-12 w-full`}>
          {t.verdict.seeSignals} <span className="font-mono">→</span>
        </button>
      </div>

    </div>
  );
}
