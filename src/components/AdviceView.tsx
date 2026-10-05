import type { Advice } from "@/lib/advisor";
import { VENUE_LABELS } from "@/lib/options";
import type { Persona } from "@/lib/personas";
import type { Trade } from "@/lib/rebalance";
import type { Holding } from "@/lib/types";
import { AllocationBar, CATEGORY_COLORS, Legend, Panel, pct, sliceBy, usd } from "./ui";

const ROLE_STYLES: Record<Advice["allocations"][number]["role"], string> = {
  defensive: "text-[#9db4c8]",
  core: "text-ink",
  growth: "text-accent",
  speculative: "text-danger",
};

function RiskMeter({ label, score }: { label: string; score: number }) {
  return (
    <div>
      <div className="flex justify-between text-xs text-muted">
        <span>{label}</span>
        <span className="num text-ink">{score}/10</span>
      </div>
      <div className="mt-1.5 flex gap-1">
        {Array.from({ length: 10 }, (_, i) => (
          <span
            key={i}
            className="h-1.5 flex-1 rounded-full"
            style={{ background: i < score ? (score >= 7 ? "var(--danger)" : score >= 4 ? "#e6c45e" : "var(--accent)") : "var(--surface-2)" }}
          />
        ))}
      </div>
    </div>
  );
}

export function AdviceView({ advice, trades, holdings, persona, plan }: {
  advice: Advice;
  trades: Trade[];
  holdings: Holding[];
  persona: Persona;
  /** Executable rebalance plan; when given it replaces the plain trade list. */
  plan?: React.ReactNode;
}) {
  const current = sliceBy(holdings, (h) => h.category, (h) => h.valueUsd);
  const target = sliceBy(advice.allocations, (a) => a.category, (a) => a.targetPct);
  const turnover = trades.filter((t) => t.action === "sell").reduce((s, t) => s + t.usd, 0);

  return (
    <div className="space-y-5">
      <Panel>
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted">The verdict, through {persona.name}&apos;s lens</p>
        <h2 className="mt-2 font-serif text-3xl leading-tight sm:text-4xl">{advice.verdict}</h2>
        <p className="mt-4 max-w-3xl text-[15px] leading-relaxed text-ink/85">{advice.diagnosis}</p>
        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <RiskMeter label="Current risk" score={advice.currentRiskScore} />
          <RiskMeter label="Target risk" score={advice.targetRiskScore} />
        </div>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-5">
        <Panel kicker="Target allocation" title="Where your money should sit" className="lg:col-span-3">
          <div className="space-y-3">
            <AllocationBar slices={current} label="Now" />
            <AllocationBar slices={target} label="Target" />
            <Legend slices={target} />
          </div>
          <ul className="mt-6 divide-y divide-line">
            {advice.allocations.map((a) => (
              <li key={`${a.asset}-${a.venue}-${a.instrument}`} className="grid grid-cols-[1fr_auto] gap-x-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="size-2 rounded-full" style={{ background: CATEGORY_COLORS[a.category] }} />
                  <span className="font-medium">{a.asset}</span>
                  <span className={`text-[11px] uppercase tracking-wider ${ROLE_STYLES[a.role]}`}>{a.role}</span>
                </div>
                <span className="num text-lg">{pct(a.targetPct, 0)}</span>
                <p className="col-span-2 mt-0.5 text-xs text-muted">
                  via <span className="font-mono text-ink/80">{a.instrument}</span> on {VENUE_LABELS[a.venue]}
                </p>
                <p className="col-span-2 mt-1 text-sm text-muted">{a.rationale}</p>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel kicker={plan ? "Rebalance plan" : "Suggested trades"} title="Rebalance once, then hold" className="lg:col-span-2">
          {plan ? (
            plan
          ) : trades.length === 0 ? (
            <p className="text-sm text-muted">You&apos;re already within 1% of the target. Keep holding.</p>
          ) : (
            <>
              <p className="text-sm text-muted">
                About <span className="num text-ink">{usd(turnover)}</span> changes hands. Sells fund the buys.
              </p>
              <ol className="mt-4 space-y-2">
                {trades.map((t) => (
                  <li key={`${t.action}-${t.asset}`} className="rounded-xl bg-surface-2 px-3.5 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span>
                        <span className={`mr-2 text-xs font-semibold uppercase ${t.action === "buy" ? "text-accent" : "text-danger"}`}>
                          {t.action}
                        </span>
                        <span className="font-medium">{t.asset}</span>
                      </span>
                      <span className="num">{usd(t.usd)}</span>
                    </div>
                    <p className="num mt-1 text-xs text-muted">
                      {pct(t.currentPct)} → {pct(t.targetPct)}
                      {t.action === "sell" && t.heldAs.length > 0 && <span className="font-sans"> · {t.heldAs.join(", ")}</span>}
                      {t.action === "buy" && t.venue && (
                        <span className="font-sans"> · {t.instrument} on {VENUE_LABELS[t.venue]}</span>
                      )}
                    </p>
                  </li>
                ))}
              </ol>
              <button
                disabled
                className="mt-5 w-full cursor-not-allowed rounded-xl border border-dashed border-line py-3 text-sm text-muted"
                title="Wallet-connected swaps via Jupiter / 0x are planned"
              >
                One-click rebalance · coming soon
              </button>
            </>
          )}
        </Panel>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <Panel kicker="Market view">
          <p className="text-[15px] leading-relaxed text-ink/85">{advice.marketView}</p>
          <p className="mt-4 border-l-2 border-accent/60 pl-4 font-serif text-lg italic leading-snug">{advice.personaTake}</p>
        </Panel>
        <Panel kicker="Before you trade">
          <h3 className="text-sm font-medium">Risks</h3>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-ink/80 marker:text-danger">
            {advice.risks.map((r) => <li key={r}>{r}</li>)}
          </ul>
          <h3 className="mt-5 text-sm font-medium">Execution tips</h3>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-ink/80 marker:text-accent">
            {advice.executionTips.map((r) => <li key={r}>{r}</li>)}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
