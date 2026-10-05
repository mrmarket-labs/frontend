"use client";

import { CHAIN_LABELS } from "@/lib/chain-labels";
import { stepUsd, type Step, type SwapStep } from "@/lib/plan";
import { EXPLORER_TX } from "@/lib/tokens";
import type { Progress } from "@/lib/wallets/progress";
import { shortAddress, type Wallet } from "@/lib/wallets/types";
import type { WalletsApi } from "@/lib/wallets/useWallets";
import { usd } from "./ui";

const FEE_PCT = 0.5;

function fmtAmount(n: number): string {
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 3 });
  return n.toLocaleString("en-US", { maximumSignificantDigits: 3 });
}

export function PlanView({ steps, wallets, progress, onReview, onMarkDone, onConnect }: {
  steps: Step[];
  wallets: WalletsApi;
  progress: Progress;
  onReview: (step: SwapStep) => void;
  onMarkDone: (step: Step) => void;
  onConnect: () => void;
}) {
  if (steps.length === 0) return <p className="text-sm text-muted">You&apos;re already within 1% of the target. Keep holding.</p>;

  // Group by the wallet that has to act; unknown addresses fall into "Other".
  const groups = new Map<string, { wallet?: Wallet; steps: Step[] }>();
  for (const step of steps) {
    const wallet = step.address ? wallets.walletFor(step.address) : undefined;
    const key = wallet?.id ?? (step.address ? `addr:${step.address}` : "other");
    const g = groups.get(key) ?? { wallet, steps: [] };
    g.steps.push(step);
    groups.set(key, g);
  }
  const ordered = [...groups.entries()].sort(([, a], [, b]) => Number(b.wallet?.mode === "connected") - Number(a.wallet?.mode === "connected"));

  const done = steps.filter((s) => progress[s.id]).length;
  const swapUsd = steps.filter((s): s is SwapStep => s.kind === "swap").reduce((t, s) => t + s.sell.usd, 0);

  return (
    <div>
      <p className="text-sm text-muted">
        <span className="num text-ink">{done}</span> of <span className="num text-ink">{steps.length}</span> steps done ·{" "}
        <span className="num text-ink">{usd(swapUsd)}</span> in swaps · est. fee <span className="num text-ink">{usd((swapUsd * FEE_PCT) / 100)}</span>
      </p>

      <div className="mt-4 space-y-5">
        {ordered.map(([key, g]) => (
          <section key={key}>
            <h3 className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wider text-muted">
              {g.wallet ? (
                <>
                  <span className="text-ink">{g.wallet.label}</span>
                  <span>{g.wallet.mode === "connected" ? "connected" : "watch-only"}</span>
                </>
              ) : key.startsWith("addr:") ? (
                <span className="font-mono">{shortAddress(key.slice(5))}</span>
              ) : (
                <span>Other venues</span>
              )}
            </h3>
            <ol className="space-y-2">
              {g.steps.map((step) => {
                const p = progress[step.id];
                const canSign = step.kind === "swap" && g.wallet?.mode === "connected";
                return (
                  <li key={step.id} className={`rounded-xl px-3.5 py-3 ${p ? "bg-surface-2/50" : "bg-surface-2"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm">
                          <span className={`mr-2 ${p ? "text-accent" : step.kind === "swap" ? "text-ink" : "text-muted"}`}>
                            {p ? "✓" : step.kind === "swap" ? "◉" : "⧗"}
                          </span>
                          <span className="text-muted">{step.kind === "swap" ? CHAIN_LABELS[step.chain] : step.where} · </span>
                          {step.kind === "swap" ? (
                            <>
                              Swap <span className="num">{fmtAmount(step.sell.amount)}</span> {step.sell.symbol} → {step.buy.symbol}
                            </>
                          ) : (
                            step.title
                          )}
                        </p>
                        <p className="mt-1 pl-5 text-xs text-muted">
                          <span className="num">~{usd(stepUsd(step))}</span>
                          {step.kind === "swap" && step.parkedUsd > 0 && (
                            <> · {step.parkedUsd < step.sell.usd - 1 ? `~${usd(step.parkedUsd)} of it ` : ""}parked as USDC for a later step</>
                          )}
                          {step.kind === "manual" && !p && <span className="block">{step.detail}</span>}
                        </p>
                      </div>
                      <div className="shrink-0">
                        {p?.txId && step.kind === "swap" ? (
                          <a href={`${EXPLORER_TX[step.chain]}${p.txId}`} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">
                            View tx ↗
                          </a>
                        ) : p ? (
                          <span className="text-xs text-muted">Done</span>
                        ) : canSign ? (
                          <button onClick={() => onReview(step)} className="rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-bg hover:bg-accent">
                            Review &amp; sign
                          </button>
                        ) : step.kind === "swap" ? (
                          <button onClick={onConnect} className="rounded-lg border border-line px-3 py-1.5 text-xs hover:border-muted" title={`Connect the wallet that owns ${shortAddress(step.address)}`}>
                            Connect to execute
                          </button>
                        ) : (
                          <button onClick={() => onMarkDone(step)} className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:border-muted hover:text-ink">
                            Mark done
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>

      {done === steps.length && (
        <p className="mt-5 rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-center font-serif text-lg">
          Portfolio rebalanced. Now hold.
        </p>
      )}
    </div>
  );
}
