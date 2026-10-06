"use client";

import { useState } from "react";
import type { Advice } from "@/lib/advisor";
import { VENUE_LABELS } from "@/lib/options";
import { getPersona } from "@/lib/personas";
import type { Step, SwapStep } from "@/lib/plan";
import type { Verdict } from "@/lib/verdict";
import type { Progress } from "@/lib/wallets/progress";
import type { WalletsApi } from "@/lib/wallets/useWallets";
import { PlanView } from "./PlanView";
import { BTN_PRIMARY, BTN_QUIET, PageHeader, Ring, SectionLabel, chartColor, pct, shortDate, sliceBy } from "./ui";

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
function targetsOf(verdict: Verdict): Target[] {
  const total = verdict.holdings.reduce((s, h) => s + h.valueUsd, 0) || 1;
  const today = (asset: string) =>
    (verdict.holdings.filter((h) => h.asset.toUpperCase() === asset.toUpperCase()).reduce((s, h) => s + h.valueUsd, 0) / total) * 100;
  const byAsset = new Map<string, Target>();
  for (const a of verdict.advice.allocations) {
    const key = a.asset.toUpperCase();
    const via = `${a.instrument} on ${VENUE_LABELS[a.venue]}`;
    const prev = byAsset.get(key);
    if (prev) byAsset.set(key, { ...prev, targetPct: prev.targetPct + a.targetPct, via: [...prev.via, via], rationale: [...prev.rationale, a.rationale] });
    else byAsset.set(key, { asset: a.asset, category: a.category, role: a.role, targetPct: a.targetPct, via: [via], rationale: [a.rationale], delta: 0 });
  }
  return [...byAsset.values()].map((t) => ({ ...t, delta: t.targetPct - today(t.asset) })).sort((a, b) => b.targetPct - a.targetPct);
}

function Delta({ points }: { points: number }) {
  if (Math.abs(points) < 1) return <div className="text-meta text-ink-3">hold</div>;
  return (
    <div className={`text-meta ${points > 0 ? "text-accent" : "text-warn"}`}>
      {points > 0 ? "+" : "−"}
      {Math.abs(points).toFixed(0)} pts
    </div>
  );
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
  const [more, setMore] = useState(false);

  if (!verdict)
    return (
      <div>
        <PageHeader title="Verdict" />
        <div className="mt-8 max-w-[26em] lg:mt-10">
          <h2 className="font-display text-display leading-[1.1]">No verdict yet.</h2>
          <p className="mt-3 text-body leading-relaxed text-ink-2">
            Pick an investor&apos;s lens and your portfolio is read through it. The read and the plan that comes out of it stay here until you run another.
          </p>
          <button type="button" onClick={onAnalyze} className={`${BTN_PRIMARY} mt-6 h-[52px] w-full lg:w-auto lg:px-7`}>
            Analyze <span className="font-mono">→</span>
          </button>
        </div>
      </div>
    );

  const { advice, holdings } = verdict;
  const persona = getPersona(verdict.personaId);
  const targets = targetsOf(verdict);
  const heldAssets = new Set(holdings.filter((h) => h.valueUsd > 0).map((h) => h.asset.toUpperCase())).size;
  const outer = sliceBy(advice.allocations, (a) => a.category, (a) => a.targetPct);
  const inner = sliceBy(holdings, (h) => h.category, (h) => h.valueUsd);
  const ringLabel = `Two concentric rings. Outer ring is the target: ${outer.map((s) => `${s.label} ${s.pct.toFixed(0)} percent`).join(", ")}. Inner ring is today: ${inner
    .map((s) => `${s.label} ${s.pct.toFixed(0)} percent`)
    .join(", ")}.`;

  return (
    <div>
      <PageHeader
        title="Verdict"
        sub={[persona && `Through ${persona.name}'s lens`, verdict.risk, verdict.horizon, `read ${shortDate(verdict.at)}`].filter(Boolean).join(" · ")}
      >
        <button type="button" onClick={onAnalyze} className={`${BTN_QUIET} h-tap px-[18px]`}>
          Run again
        </button>
      </PageHeader>

      <div className="mt-5 lg:mt-8 lg:flex lg:flex-wrap lg:items-start lg:gap-gap-col">
        {/* The read */}
        <div className="min-w-0 lg:flex-[999_1_460px]">
          <h2 className="max-w-[19em] font-display text-display leading-[1.12]">{advice.verdict}</h2>
          <p className="mt-3.5 max-w-[36em] text-body leading-relaxed text-ink-2">{advice.diagnosis}</p>

          <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} className="mt-1 flex h-tap items-center gap-2 text-label text-ink-2 hover:text-ink">
            More of the reasoning <span className="num">{more ? "−" : "+"}</span>
          </button>
          {more && (
            <div className="max-w-[36em] space-y-3 pb-2 text-body leading-relaxed text-ink-2">
              <p>{advice.marketView}</p>
              <p>{advice.personaTake}</p>
              <ul className="space-y-1.5">
                {targets.map((t) => (
                  <li key={t.asset}>
                    <span className="text-ink">{t.asset}</span> — {t.rationale.join(" ")}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <span className="text-label text-ink-3">Risk</span>
            <span className={`num text-body ${advice.currentRiskScore > advice.targetRiskScore ? "text-warn" : ""}`}>{advice.currentRiskScore}/10</span>
            <span className="num text-meta text-rule">→</span>
            <span className="num text-body">{advice.targetRiskScore}/10</span>
            <span className="text-label text-ink-3">if you follow this</span>
          </div>

          <div className="mt-5 rounded-card bg-surface px-4 py-[18px] lg:mt-8 lg:flex lg:flex-wrap lg:items-center lg:gap-9 lg:rounded-none lg:bg-transparent lg:p-0">
            <div className="flex items-baseline justify-between lg:hidden">
              <SectionLabel>Now vs target</SectionLabel>
              <span className="text-meta text-ink-3">inner ring is today</span>
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
                <div className="mt-[3px] text-meta text-ink-3">
                  holding{targets.length === 1 ? "" : "s"}, from {heldAssets}
                </div>
              </div>
            </div>

            <div className="mt-3 flex min-w-0 flex-col gap-[13px] lg:mt-0 lg:flex-[999_1_240px]">
              <SectionLabel className="hidden lg:block">Now vs target · inner ring is today</SectionLabel>
              {targets.map((t) => (
                <div key={t.asset} className="flex items-center gap-[11px]">
                  <span className="size-[9px] flex-none rounded-full" style={{ background: chartColor(t.category) }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-[7px]">
                      <span className="text-row">{t.asset}</span>
                      <span className="text-meta capitalize text-ink-3">{t.role}</span>
                    </div>
                    <div className="text-meta text-ink-4">via {t.via.join(" + ")}</div>
                  </div>
                  <div className="num flex-none text-right">
                    <div className="text-body">{pct(t.targetPct, 0)}</div>
                    <Delta points={t.delta} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* The plan */}
        <div className="mt-8 min-w-0 lg:mt-0 lg:flex-[1_1_420px] lg:rounded-card lg:bg-surface lg:px-[22px] lg:py-6">
          <div className="flex items-center gap-3">
            <h3 className="font-display text-title leading-[1.1]">What to do about it</h3>
            <span className="h-px flex-1 bg-accent lg:hidden" />
          </div>
          <PlanView verdict={verdict} wallets={wallets} progress={progress} onReview={onReview} onMarkDone={onMarkDone} onWallets={onWallets} />

          <div className="mt-[18px] rounded-card-sm bg-surface px-[15px] py-3.5 lg:mt-5 lg:rounded-none lg:border-t lg:border-hairline lg:bg-transparent lg:px-0 lg:pb-0 lg:pt-4">
            <SectionLabel>Before you trade</SectionLabel>
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
        <SectionLabel>And after that</SectionLabel>
        <h2 className="mt-2 font-display text-title leading-[1.12]">
          Nothing — until the market <span className="block italic text-accent">gets greedy enough to matter.</span>
        </h2>
        <p className="mt-2.5 text-label leading-normal text-accent-text">
          This verdict stays on file. Signals show when the market regime moves against it — never a price alert.
        </p>
        <button type="button" onClick={onSignals} className={`${BTN_PRIMARY} mt-3.5 h-12 w-full`}>
          See signals <span className="font-mono">→</span>
        </button>
      </div>

    </div>
  );
}
