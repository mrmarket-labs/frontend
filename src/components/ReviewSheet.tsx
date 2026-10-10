"use client";

import { useCallback, useEffect, useState } from "react";
import { explain } from "@/lib/explainers";
import { errorMessage } from "@/lib/i18n";
import { useT } from "@/lib/i18n/context";
import type { SwapStep } from "@/lib/plan";
import { EXPLORER_TX } from "@/lib/tokens";
import { describeQuote, executeStep, fetchQuote, type Phase, type Quote } from "@/lib/wallets/execute";
import { shortAddress, type Wallet } from "@/lib/wallets/types";
import { BTN_PRIMARY, SectionLabel, Spinner, usd } from "./ui";

const QUOTE_TTL_SEC = 30;
type State = "quoting" | "ready" | Phase | "done" | "failed";

function fmt(n: number, maxSig = 6): string {
  return n.toLocaleString("en-US", { maximumSignificantDigits: maxSig });
}

function TokenMark({ symbol }: { symbol: string }) {
  return (
    <span aria-hidden className="flex size-[26px] flex-none items-center justify-center rounded-full bg-surface-raised text-meta font-semibold text-ink">
      {symbol.charAt(0).toUpperCase()}
    </span>
  );
}

function Term({ label, children, hot = false }: { label: string; children: React.ReactNode; hot?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="flex-none text-label text-ink-2">{label}</dt>
      <dd className={`num min-w-0 text-right text-label ${hot ? "text-risk" : ""}`}>{children}</dd>
    </div>
  );
}

export function ReviewSheet({ step, wallet, onClose, onDone }: {
  step: SwapStep;
  wallet: Wallet;
  onClose: () => void;
  onDone: (txId: string) => void;
}) {
  const t = useT();
  const [state, setState] = useState<State>("quoting");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ttl, setTtl] = useState(QUOTE_TTL_SEC);
  const [txId, setTxId] = useState<string | null>(null);

  const loadQuote = useCallback(async () => {
    setState("quoting");
    setError(null);
    try {
      setQuote(await fetchQuote(step));
      setTtl(QUOTE_TTL_SEC);
      setState("ready");
    } catch (e) {
      setError(errorMessage(e, t));
      setState("failed");
    }
  }, [step, t]);

  useEffect(() => {
    // The quote is remote state fetched on open; the effect only kicks off the request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadQuote();
  }, [loadQuote]);

  // Quotes go stale fast; refresh while the user is still reading.
  useEffect(() => {
    if (state !== "ready") return;
    const timer = setInterval(() => setTtl((v) => (v <= 1 ? (void loadQuote(), QUOTE_TTL_SEC) : v - 1)), 1000);
    return () => clearInterval(timer);
  }, [state, loadQuote]);

  async function sign() {
    if (!quote) return;
    setError(null);
    setTxId(null);
    try {
      const id = await executeStep(step, wallet, quote, setState, setTxId);
      setTxId(id);
      setState("done");
    } catch (e) {
      const msg = errorMessage(e, t);
      setError(/reject|denied|cancel/i.test(msg) ? t.review.cancelled : msg);
      setState("failed");
    }
  }

  const d = quote ? describeQuote(step, quote) : null;
  const busy = state === "approving" || state === "signing" || state === "confirming";
  const info = explain(step.buy.symbol);
  const explorer = txId ? `${EXPLORER_TX[step.chain]}${txId}` : null;
  const link = "underline underline-offset-2 hover:text-ink";
  const chain = t.chains[step.chain];

  useEffect(() => {
    if (busy) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ground/70 backdrop-blur-sm sm:items-center sm:p-6" onClick={busy ? undefined : onClose}>
      <div
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-card bg-surface-track px-5 pt-3 pb-[max(26px,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-card sm:pt-6"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t.review.dialogLabel(chain)}
      >
        <div className="mx-auto mb-4 h-1 w-[38px] rounded-pill bg-rule sm:hidden" />

        <div className="flex items-center justify-between gap-3">
          <SectionLabel>{t.review.title(chain)}</SectionLabel>
          <span className="flex min-w-0 items-center gap-1.5 text-meta text-ink-2">
            <span className="size-1.5 flex-none rounded-full bg-accent" />
            <span className="truncate">{wallet.label}</span>
            <span className="num flex-none text-ink-3">{shortAddress(step.address)}</span>
          </span>
        </div>

        <div className="mt-[18px] flex items-center gap-3.5">
          <div className="min-w-0 flex-1">
            <div className="text-meta text-ink-3">{t.review.youPay}</div>
            <div className="mt-1.5 flex items-center gap-2">
              <TokenMark symbol={step.sell.symbol} />
              <span className="num truncate text-wordmark">{fmt(step.sell.amount)}</span>
            </div>
            <div className="mt-1 text-meta text-ink-3">
              {step.sell.symbol} · <span className="num">~{usd(step.sell.usd)}</span>
            </div>
          </div>
          <span className="num flex-none text-[18px] text-accent">→</span>
          <div className="min-w-0 flex-1 text-right">
            <div className="text-meta text-ink-3">{t.review.youReceive}</div>
            <div className="mt-1.5 flex items-center justify-end gap-2">
              {d ? (
                <span className="num truncate text-wordmark">{fmt(d.receive)}</span>
              ) : state === "quoting" ? (
                <span className="flex items-center gap-2 text-label text-ink-2">
                  <Spinner /> {t.review.gettingQuote}
                </span>
              ) : (
                <span className="num text-wordmark text-ink-3">—</span>
              )}
              <TokenMark symbol={step.buy.symbol} />
            </div>
            <div className="mt-1 text-meta text-ink-3">{step.buy.symbol}</div>
          </div>
        </div>

        {d && (
          <dl className="mt-[18px] flex flex-col gap-2.5 border-t border-hairline pt-3.5">
            <Term label={t.review.rate}>
              1 {step.sell.symbol} = {fmt(d.receive / d.pay, 4)} {step.buy.symbol}
            </Term>
            <Term label={t.review.route}>{d.route.join(" · ") || t.review.aggregator}</Term>
            <Term label={t.review.maxSlippage}>0.5%</Term>
            <Term label={t.review.minReceived}>
              ≥ {fmt(d.minReceive)} {step.buy.symbol}
            </Term>
            {d.priceImpactPct != null && (
              <Term label={t.review.priceImpact} hot={d.priceImpactPct > 1}>
                {d.priceImpactPct.toFixed(2)}%
              </Term>
            )}
            {d.networkFeeUsd != null && d.networkFeeUsd > 0 && <Term label={t.review.networkFee}>{d.networkFeeUsd < 0.01 ? "< $0.01" : `~${usd(d.networkFeeUsd)}`}</Term>}
            <Term label={t.review.diversifyFee}>{d.feeBps > 0 ? `${d.feeBps / 100}% · ${usd(d.feeUsd)}` : t.review.noFee}</Term>
          </dl>
        )}

        {info && (
          <div className="mt-4 rounded-input bg-surface-nav-on px-[13px] py-3">
            <div className="flex items-start gap-[9px]">
              <span aria-hidden className="num mt-px flex size-4 flex-none items-center justify-center rounded-full border border-live text-[9px] text-accent">
                ?
              </span>
              <p className="text-meta leading-normal text-ink-2">
                <span className="font-medium text-ink">{t.review.youAreBuying(step.buy.symbol)}</span> {info.what}
              </p>
            </div>
            {info.trust && (
              <div className="mt-[9px] flex items-start gap-[9px] border-t border-hairline pt-[9px]">
                <span aria-hidden className="num mt-px flex size-4 flex-none items-center justify-center rounded-full border border-warn text-[9px] text-warn">
                  !
                </span>
                <p className="text-meta leading-normal text-ink-2">{info.trust}</p>
              </div>
            )}
          </div>
        )}

        {d?.needsApproval && state === "ready" && (
          <p className="mt-3.5 text-meta leading-normal text-ink-2">
            {step.chain === "hyperliquid" ? t.review.builderApprovalNote(`${d.feeBps / 100}%`) : t.review.approvalNote(fmt(step.sell.amount), step.sell.symbol)}
          </p>
        )}
        {step.chain === "hyperliquid" && d && <p className="mt-2 text-meta leading-normal text-ink-3">{t.review.hyperliquidNote}</p>}
        {error && <p className="mt-3.5 text-body leading-normal text-risk">{error}</p>}
        {busy && (
          <p className="mt-3.5 flex items-center gap-2 text-body text-ink-2">
            <Spinner /> <span className="min-w-0 flex-1">{step.chain === "hyperliquid" ? t.review.hyperliquidPhases[state as Phase] : t.review.phases[state as Phase]}</span>
            {explorer && state === "confirming" && (
              <a href={explorer} target="_blank" rel="noreferrer" className={`flex-none text-meta ${link}`}>
                {t.review.viewOnExplorer}
              </a>
            )}
          </p>
        )}
        {state === "failed" && explorer && txId && (
          <p className="mt-2 text-meta text-ink-3">
            {t.review.sentAs}{" "}
            <a href={explorer} target="_blank" rel="noreferrer" className={`num text-ink-2 ${link}`}>
              {txId.slice(0, 8)}…{txId.slice(-6)} ↗
            </a>
          </p>
        )}
        {state === "done" && explorer && (
          <p className="mt-3.5 rounded-input bg-surface-live px-3.5 py-3 text-body text-accent-text">
            {t.review.confirmed}{" "}
            <a href={explorer} target="_blank" rel="noreferrer" className={link}>
              {t.review.viewOnExplorer}
            </a>
          </p>
        )}

        {state === "done" ? (
          <button type="button" onClick={() => onDone(txId!)} className={`${BTN_PRIMARY} mt-[18px] h-[52px] w-full`}>
            {t.review.done}
          </button>
        ) : (
          <>
            {state === "failed" ? (
              <button type="button" onClick={loadQuote} className={`${BTN_PRIMARY} mt-[18px] h-[52px] w-full`}>
                {t.review.retry}
              </button>
            ) : (
              <button type="button" onClick={sign} disabled={state !== "ready"} className={`${BTN_PRIMARY} mt-[18px] h-[52px] w-full`}>
                {d?.needsApproval ? t.review.approveAndSign(wallet.label) : t.review.sign(wallet.label)}
              </button>
            )}
            {state === "ready" && <p className="num mt-2 text-center text-meta text-ink-3">{t.review.refreshesIn(ttl)}</p>}
            <button type="button" onClick={onClose} disabled={busy} className="mt-1 flex h-tap w-full items-center justify-center text-body text-ink-2 hover:text-ink disabled:opacity-40">
              {t.review.backToPlan}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
