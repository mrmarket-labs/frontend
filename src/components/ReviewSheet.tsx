"use client";

import { useCallback, useEffect, useState } from "react";
import { CHAIN_LABELS } from "@/lib/chain-labels";
import type { SwapStep } from "@/lib/plan";
import { EXPLORER_TX } from "@/lib/tokens";
import { describeQuote, executeStep, fetchQuote, type Phase, type Quote } from "@/lib/wallets/execute";
import { shortAddress, type Wallet } from "@/lib/wallets/types";
import { Spinner, usd } from "./ui";

const QUOTE_TTL_SEC = 30;
type State = "quoting" | "ready" | Phase | "done" | "failed";

const PHASE_LABEL: Record<Phase, string> = {
  approving: "Approve the token in your wallet…",
  signing: "Confirm the swap in your wallet…",
  confirming: "Sent. Rebroadcasting until the network confirms it…",
};

function fmt(n: number, maxSig = 6): string {
  return n.toLocaleString("en-US", { maximumSignificantDigits: maxSig });
}

export function ReviewSheet({ step, wallet, onClose, onDone }: {
  step: SwapStep;
  wallet: Wallet;
  onClose: () => void;
  onDone: (txId: string) => void;
}) {
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
      setError(e instanceof Error ? e.message : String(e));
      setState("failed");
    }
  }, [step]);

  useEffect(() => {
    // The quote is remote state fetched on open; the effect only kicks off the request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadQuote();
  }, [loadQuote]);

  // Quotes go stale fast; refresh while the user is still reading.
  useEffect(() => {
    if (state !== "ready") return;
    const timer = setInterval(() => setTtl((t) => (t <= 1 ? (void loadQuote(), QUOTE_TTL_SEC) : t - 1)), 1000);
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
      const msg = e instanceof Error ? e.message : String(e);
      setError(/reject|denied|cancel/i.test(msg) ? "You cancelled the request in your wallet." : msg);
      setState("failed");
    }
  }

  const d = quote ? describeQuote(step, quote) : null;
  const busy = state === "approving" || state === "signing" || state === "confirming";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-6" onClick={busy ? undefined : onClose}>
      <div
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-line bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-baseline justify-between">
          <h3 className="font-serif text-2xl">Swap on {CHAIN_LABELS[step.chain]}</h3>
          <span className="text-xs text-muted">
            {wallet.label} · <span className="font-mono">{shortAddress(step.address)}</span>
          </span>
        </div>

        <dl className="mt-5 space-y-2.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">You pay</dt>
            <dd className="num text-right">
              {fmt(step.sell.amount)} {step.sell.symbol} <span className="text-muted">({usd(step.sell.usd)})</span>
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">You receive</dt>
            <dd className="num text-right">
              {d ? (
                <>
                  ≥ {fmt(d.minReceive)} {step.buy.symbol}
                  <span className="block text-xs text-muted">quote {fmt(d.receive)}, 0.5% max slippage</span>
                </>
              ) : state === "quoting" ? (
                <span className="inline-flex items-center gap-2 text-muted"><Spinner /> getting quote</span>
              ) : (
                "—"
              )}
            </dd>
          </div>
          {d && (
            <>
              <div className="flex justify-between">
                <dt className="text-muted">Diversify fee</dt>
                <dd className="num">{d.feeBps > 0 ? `${d.feeBps / 100}% · ${usd(d.feeUsd)}` : "none on this trade"}</dd>
              </div>
              {d.priceImpactPct != null && (
                <div className="flex justify-between">
                  <dt className="text-muted">Price impact</dt>
                  <dd className={`num ${d.priceImpactPct > 1 ? "text-danger" : ""}`}>{d.priceImpactPct.toFixed(2)}%</dd>
                </div>
              )}
              {d.networkFeeUsd != null && d.networkFeeUsd > 0 && (
                <div className="flex justify-between">
                  <dt className="text-muted">Network fee</dt>
                  <dd className="num">{d.networkFeeUsd < 0.01 ? "< $0.01" : `~${usd(d.networkFeeUsd)}`}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-muted">Route</dt>
                <dd className="text-right text-xs">{d.route.join(" · ") || "aggregator"}</dd>
              </div>
            </>
          )}
        </dl>

        {d?.needsApproval && state === "ready" && (
          <p className="mt-4 rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
            ⚠ Your wallet will first ask to approve exactly {fmt(step.sell.amount)} {step.sell.symbol} for the swap contract, then the swap itself.
          </p>
        )}
        {error && <p className="mt-4 text-sm text-danger">{error}</p>}
        {busy && (
          <p className="mt-4 flex items-center gap-2 text-sm text-muted">
            <Spinner /> {PHASE_LABEL[state as Phase]}
            {txId && state === "confirming" && (
              <a href={`${EXPLORER_TX[step.chain]}${txId}`} target="_blank" rel="noreferrer" className="ml-auto text-xs text-accent hover:underline">
                View on explorer ↗
              </a>
            )}
          </p>
        )}
        {state === "failed" && txId && (
          <p className="mt-2 text-xs text-muted">
            Sent as{" "}
            <a href={`${EXPLORER_TX[step.chain]}${txId}`} target="_blank" rel="noreferrer" className="text-accent hover:underline">
              {txId.slice(0, 8)}…{txId.slice(-6)} ↗
            </a>
          </p>
        )}
        {state === "done" && txId && (
          <p className="mt-4 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-sm">
            Swap confirmed.{" "}
            <a href={`${EXPLORER_TX[step.chain]}${txId}`} target="_blank" rel="noreferrer" className="text-accent hover:underline">
              View on explorer ↗
            </a>
          </p>
        )}

        <div className="mt-5 flex items-center justify-between gap-3">
          {state === "ready" ? (
            <span className="num text-xs text-muted">quote refreshes in {ttl}s</span>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            {state === "done" ? (
              <button onClick={() => onDone(txId!)} className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-bg">
                Done
              </button>
            ) : (
              <>
                <button onClick={onClose} disabled={busy} className="rounded-xl border border-line px-4 py-2 text-sm disabled:opacity-40">
                  Cancel
                </button>
                {state === "failed" ? (
                  <button onClick={loadQuote} className="rounded-xl bg-ink px-4 py-2 text-sm font-medium text-bg hover:bg-accent">
                    Retry
                  </button>
                ) : (
                  <button
                    onClick={sign}
                    disabled={state !== "ready"}
                    className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-bg transition hover:brightness-110 disabled:opacity-40"
                  >
                    {d?.needsApproval ? "Approve & swap" : "Swap"}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
