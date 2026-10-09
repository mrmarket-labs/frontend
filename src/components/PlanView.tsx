"use client";

import { useState } from "react";
import { explain } from "@/lib/explainers";
import type { Dict } from "@/lib/i18n";
import { useT } from "@/lib/i18n/context";
import { stepUsd, type ManualStep, type Step, type SwapStep } from "@/lib/plan";
import { EXPLORER_TX } from "@/lib/tokens";
import type { Verdict } from "@/lib/verdict";
import type { Progress, StepProgress } from "@/lib/wallets/progress";
import { sameAddress, shortAddress, type Wallet } from "@/lib/wallets/types";
import type { WalletsApi } from "@/lib/wallets/useWallets";
import { BTN_TONAL, SectionLabel, WalletMark, usd } from "./ui";

const FEE_PCT = 0.5;

function fmtAmount(n: number): string {
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 3 });
  return n.toLocaleString("en-US", { maximumSignificantDigits: 3 });
}

/** Canonical assets on both sides of a swap, so its effect reads in the same terms as the targets. */
function swapAssets(step: SwapStep, verdict: Verdict): { sell: string; buy: string } {
  const held = verdict.holdings.find((h) => sameAddress(h.address, step.address) && h.chain === step.chain && h.symbol === step.sell.symbol);
  const wanted = step.buy.symbol.toUpperCase();
  const target = verdict.advice.allocations.find((a) => a.instrument.toUpperCase() === wanted || a.asset.toUpperCase() === wanted);
  const alreadyHeld = verdict.holdings.find((h) => h.symbol.toUpperCase() === wanted);
  return { sell: held?.asset ?? step.sell.symbol, buy: target?.asset ?? alreadyHeld?.asset ?? step.buy.symbol };
}

/**
 * The advisor's own words for a move: why to let go of what is sold, why what is bought earns its
 * place. Parking in a stablecoin has no "buy" reason; the parked note covers it.
 */
function whyLine(verdict: Verdict, sell: string | null, buy: string | null): string | null {
  const same = (a: string, b: string) => a.toUpperCase() === b.toUpperCase();
  const trim = sell ? verdict.advice.trims?.find((x) => same(x.asset, sell))?.reason : null;
  const add = buy ? verdict.advice.allocations.find((a) => same(a.asset, buy))?.rationale : null;
  const parts = [trim, add].filter((x): x is string => Boolean(x));
  return parts.length ? parts.join(" ") : null;
}

function WhyRow({ text }: { text: string | null }) {
  const t = useT();
  if (!text) return null;
  return (
    <div className="mt-[9px] flex gap-x-2">
      <span className="flex-none text-meta text-ink-4">{t.plan.why}</span>
      <p className="min-w-0 text-meta leading-normal text-ink-2">{text}</p>
    </div>
  );
}

/** What this one swap does to the allocation if nothing else is taken. */
function impactLine(step: SwapStep, verdict: Verdict, t: Dict): string {
  const total = verdict.holdings.reduce((s, h) => s + h.valueUsd, 0) || 1;
  const share = (asset: string) =>
    (verdict.holdings.filter((h) => h.asset.toUpperCase() === asset.toUpperCase()).reduce((s, h) => s + h.valueUsd, 0) / total) * 100;
  const moved = (step.sell.usd / total) * 100;
  const fmt = (n: number) => `${Math.max(0, n).toFixed(moved < 1 ? 1 : 0)}%`;
  const { sell, buy } = swapAssets(step, verdict);
  if (sell.toUpperCase() === buy.toUpperCase()) return t.plan.staysAt(sell, fmt(share(sell)));
  return `${sell} ${fmt(share(sell))} → ${fmt(share(sell) - moved)} · ${buy} ${fmt(share(buy))} → ${fmt(share(buy) + moved)}`;
}

/** A short phrase for what the swap fixes. Only the largest one earns the accent. */
function tagFor(step: SwapStep, verdict: Verdict, biggestId: string | undefined, t: Dict): { text: string; lead: boolean } {
  if (step.id === biggestId) return { text: t.plan.tagBiggest, lead: true };
  const total = verdict.holdings.reduce((s, h) => s + h.valueUsd, 0) || 1;
  const { sell } = swapAssets(step, verdict);
  const exit = verdict.trades.find((tr) => tr.action === "sell" && tr.asset.toUpperCase() === sell.toUpperCase());
  if (exit && exit.targetPct < 1) return { text: t.plan.tagSimplifies, lead: false };
  if (step.sell.usd / total < 0.01) return { text: t.plan.tagOptional(`$${Math.round(step.sell.usd)}`), lead: false };
  if (step.parkedUsd > 0) return { text: t.plan.tagFrees, lead: false };
  return { text: t.plan.tagNarrows, lead: false };
}

function DoneRow({ step, p }: { step: Step; p: StepProgress }) {
  const t = useT();
  return (
    <div className="mt-3 flex min-h-tap items-center gap-3 text-label text-ink-3">
      <span>{t.plan.done}</span>
      {p.txId && step.kind === "swap" && (
        <a
          href={`${EXPLORER_TX[step.chain]}${p.txId}`}
          target="_blank"
          rel="noreferrer"
          className="flex min-h-tap items-center text-ink-2 underline underline-offset-2 hover:text-ink"
        >
          {t.plan.viewTx}
        </a>
      )}
    </div>
  );
}

function SwapCard({ step, verdict, wallet, p, tag, open, onToggle, onReview, onWallets }: {
  step: SwapStep;
  verdict: Verdict;
  wallet: Wallet | undefined;
  p: StepProgress | undefined;
  tag: { text: string; lead: boolean };
  open: boolean;
  onToggle: () => void;
  onReview: (step: SwapStep) => void;
  onWallets: () => void;
}) {
  const t = useT();
  const info = explain(step.buy.symbol);
  const canSign = wallet?.mode === "connected";
  const owner = wallet?.label ?? shortAddress(step.address);
  const parkedNote = step.parkedUsd < step.sell.usd - 1 ? t.plan.parkedPart(usd(step.parkedUsd)) : t.plan.parkedAll;
  const { sell, buy } = swapAssets(step, verdict);
  const why = whyLine(verdict, sell, step.parkedUsd >= step.sell.usd - 1 ? null : buy);

  return (
    <li className={`rounded-card-sm bg-surface px-[15px] py-3.5 lg:bg-surface-control ${p ? "opacity-60" : ""}`}>
      <div className="flex items-center justify-between gap-2.5">
        <span className="flex min-w-0 items-center gap-[7px]">
          <WalletMark wallet={wallet ?? { mode: "watched", label: "·" }} size={16} />
          <span className="truncate text-meta text-ink-3">
            {wallet ? wallet.label : <span className="num">{owner}</span>} · {t.chains[step.chain]}
          </span>
        </span>
        <span className={`flex-none text-meta ${tag.lead && !p ? "text-accent" : "text-ink-3"}`}>{tag.text}</span>
      </div>

      <div className="mt-2.5 flex flex-wrap items-baseline gap-x-[9px] gap-y-1">
        <span className="num text-[15px]">
          {fmtAmount(step.sell.amount)} {step.sell.symbol}
        </span>
        <span className="num text-body text-accent">→</span>
        <span className="num text-[15px]">{step.buy.symbol}</span>
        <span className="flex-1" />
        <span className="num text-label text-ink-2">~{usd(step.sell.usd)}</span>
      </div>

      <div className="mt-[9px] flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="flex-none text-meta text-ink-4">{t.plan.onItsOwn}</span>
        <span className="num text-meta text-ink-2">{impactLine(step, verdict, t)}</span>
      </div>
      {step.parkedUsd > 0 && <p className="mt-1.5 text-meta leading-normal text-ink-3">{parkedNote}</p>}
      {!p && <WhyRow text={why} />}

      {p ? (
        <DoneRow step={step} p={p} />
      ) : (
        <div className="mt-[11px] flex items-center gap-2.5">
          {canSign ? (
            <button type="button" onClick={() => onReview(step)} className={`${BTN_TONAL} h-tap min-w-0 flex-1 px-3`}>
              <span className="truncate">{t.plan.swapIn(owner)}</span>
            </button>
          ) : (
            <button type="button" onClick={onWallets} title={t.plan.connectOwner(shortAddress(step.address))} className={`${BTN_TONAL} h-tap min-w-0 flex-1 px-3`}>
              {t.plan.connectToExecute}
            </button>
          )}
          {info && (
            <button type="button" onClick={onToggle} aria-expanded={open} className="h-tap flex-none rounded-nav px-2 text-label text-ink-2 hover:text-ink">
              {t.plan.whatIs(step.buy.symbol)} <span className="num">{open ? "−" : "+"}</span>
            </button>
          )}
        </div>
      )}
      {info && open && !p && <p className="mt-2.5 text-meta leading-normal text-ink-2">{info.what}</p>}
    </li>
  );
}

function ManualCard({ step, verdict, wallet, p, onMarkDone }: {
  step: ManualStep;
  verdict: Verdict;
  wallet: Wallet | undefined;
  p: StepProgress | undefined;
  onMarkDone: (step: Step) => void;
}) {
  const t = useT();
  const why = step.move ? whyLine(verdict, step.move.action === "sell" ? step.move.asset : null, step.move.action === "buy" ? step.move.asset : null) : null;
  return (
    <li className={`rounded-card-sm bg-surface px-[15px] py-3.5 lg:bg-surface-control ${p ? "opacity-60" : ""}`}>
      <div className="flex items-center justify-between gap-2.5">
        <span className="flex min-w-0 items-center gap-[7px]">
          {wallet && <WalletMark wallet={wallet} size={16} />}
          <span className="truncate text-meta text-ink-3">
            {wallet ? `${wallet.label} · ` : step.address ? <span className="num">{shortAddress(step.address)} · </span> : null}
            {step.where}
          </span>
        </span>
        <span className="num flex-none text-label text-ink-2">~{usd(step.usd)}</span>
      </div>
      <p className="mt-2.5 text-row">{step.title}</p>
      {p ? (
        <DoneRow step={step} p={p} />
      ) : (
        <>
          <p className="mt-1.5 text-meta leading-normal text-ink-2">{step.detail}</p>
          <WhyRow text={why} />
          <button type="button" onClick={() => onMarkDone(step)} className={`${BTN_TONAL} mt-[11px] h-tap w-full px-3`}>
            {t.plan.markDone}
          </button>
        </>
      )}
    </li>
  );
}

export function PlanView({ verdict, wallets, progress, onReview, onMarkDone, onWallets }: {
  verdict: Verdict;
  wallets: WalletsApi;
  progress: Progress;
  onReview: (step: SwapStep) => void;
  onMarkDone: (step: Step) => void;
  /** Open the wallets screen, e.g. to connect the wallet a swap has to be signed in. */
  onWallets: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const { steps } = verdict;

  if (steps.length === 0) return <p className="mt-2 text-label leading-normal text-ink-2">{t.plan.withinTarget}</p>;

  const swaps = steps.filter((s): s is SwapStep => s.kind === "swap");
  const manual = steps.filter((s): s is ManualStep => s.kind === "manual");
  const done = steps.filter((s) => progress[s.id]).length;
  const swapUsd = swaps.reduce((sum, s) => sum + s.sell.usd, 0);
  const biggestId = swaps.reduce<SwapStep | undefined>((top, s) => (!top || stepUsd(s) > stepUsd(top) ? s : top), undefined)?.id;
  const signers = [...new Set(swaps.map((s) => wallets.walletFor(s.address)?.label ?? shortAddress(s.address)))];

  return (
    <div>
      <p className="mt-2 text-label leading-normal text-ink-2">{swaps.length === 0 ? t.plan.allManual : t.plan.swapsClose(swaps.length, manual.length > 0)}</p>
      {(swaps.length > 0 || done > 0) && (
        <p className="num mt-[7px] text-meta text-ink-4">
          {[
            swaps.length > 0 && t.plan.ifYouTakeAll(usd(swapUsd)),
            swaps.length > 0 && t.plan.estFee(usd((swapUsd * FEE_PCT) / 100)),
            done > 0 && t.plan.doneOf(done, steps.length),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}

      {swaps.length > 0 && (
        <ul className="mt-[18px] flex flex-col gap-2.5">
          {swaps.map((step) => (
            <SwapCard
              key={step.id}
              step={step}
              verdict={verdict}
              wallet={wallets.walletFor(step.address)}
              p={progress[step.id]}
              tag={tagFor(step, verdict, biggestId, t)}
              open={!!open[step.id]}
              onToggle={() => setOpen((o) => ({ ...o, [step.id]: !o[step.id] }))}
              onReview={onReview}
              onWallets={onWallets}
            />
          ))}
        </ul>
      )}

      {manual.length > 0 && (
        <>
          <SectionLabel className="mt-5">{t.plan.outsideTheApp}</SectionLabel>
          <ul className="mt-2.5 flex flex-col gap-2.5">
            {manual.map((step) => (
              <ManualCard key={step.id} step={step} verdict={verdict} wallet={step.address ? wallets.walletFor(step.address) : undefined} p={progress[step.id]} onMarkDone={onMarkDone} />
            ))}
          </ul>
        </>
      )}

      {done === steps.length && <p className="mt-5 rounded-control bg-surface-live px-4 py-3.5 text-center font-display text-title leading-tight">{t.plan.rebalanced}</p>}

      {swaps.length > 0 && (
        <p className="mt-4 text-meta leading-normal text-ink-3">
          {signers.length > 1 ? t.plan.signedInMany(signers[0], signers[1]) : t.plan.signedInOne(signers[0])} {t.plan.quotesRefresh}
        </p>
      )}
    </div>
  );
}
