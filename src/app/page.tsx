"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AdviceView } from "@/components/AdviceView";
import { MarketPanel } from "@/components/MarketPanel";
import { PlanView } from "@/components/PlanView";
import { PortfolioView } from "@/components/PortfolioView";
import { ReviewSheet } from "@/components/ReviewSheet";
import { Panel, Spinner } from "@/components/ui";
import { WalletsPanel } from "@/components/WalletsPanel";
import type { Advice } from "@/lib/advisor";
import { HORIZONS, RISK_LEVELS, type Horizon, type RiskLevel } from "@/lib/options";
import { PERSONAS } from "@/lib/personas";
import { compilePlan, type Step, type SwapStep } from "@/lib/plan";
import type { Trade } from "@/lib/rebalance";
import type { Holding, MarketSnapshot, PortfolioResponse } from "@/lib/types";
import { loadProgress, saveProgress, type Progress } from "@/lib/wallets/progress";
import { getSession, signIn, signOut, signableAddress, type SessionInfo } from "@/lib/wallets/signin";
import { shortAddress } from "@/lib/wallets/types";
import { useWallets } from "@/lib/wallets/useWallets";

interface Result {
  advice: Advice;
  trades: Trade[];
  /** Holdings the plan was built from; the plan stays fixed while the portfolio view refreshes. */
  holdings: Holding[];
  steps: Step[];
  personaId: string;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

function Segmented<T extends string>({ options, value, onChange }: { options: readonly T[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-xl bg-surface-2 p-1">
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={`flex-1 rounded-lg px-2 py-1.5 text-sm capitalize transition ${value === o ? "bg-ink text-bg" : "text-muted hover:text-ink"}`}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

export default function Home() {
  const wallets = useWallets();
  const [portfolio, setPortfolio] = useState<PortfolioResponse | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const [market, setMarket] = useState<MarketSnapshot | null>(null);
  const [marketError, setMarketError] = useState<string | null>(null);

  const [personaId, setPersonaId] = useState(PERSONAS[0].id);
  const [risk, setRisk] = useState<RiskLevel>("balanced");
  const [horizon, setHorizon] = useState<Horizon>("3+ years");
  const [allowPerps, setAllowPerps] = useState(false);
  const [advising, setAdvising] = useState(false);
  const [adviceError, setAdviceError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const [session, setSession] = useState<SessionInfo | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress>({});
  const pendingScan = useRef(false);
  const [walletsVersion, setWalletsVersion] = useState(0);
  const [review, setReview] = useState<SwapStep | null>(null);
  const [pickerSignal, setPickerSignal] = useState(0);
  const walletsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProgress(loadProgress());
    getSession().then(setSession).catch(() => undefined);
    fetch("/api/market")
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        setMarket(data);
      })
      .catch((e) => setMarketError(`Market data unavailable: ${e.message}`));
  }, []);

  const addresses = wallets.allAddresses;
  const persona = PERSONAS.find((p) => p.id === personaId)!;

  const scan = useCallback(
    async (quiet = false) => {
      if (addresses.length === 0) return;
      setScanning(true);
      setScanError(null);
      if (!quiet) setResult(null);
      try {
        setPortfolio(await postJson<PortfolioResponse>("/api/portfolio", { addresses: addresses.join("\n") }));
      } catch (e) {
        setScanError(e instanceof Error ? e.message : String(e));
      } finally {
        setScanning(false);
      }
    },
    [addresses],
  );

  // The address list only settles after a connect/merge finishes, so scan from an effect
  // instead of from the click handler (which would see the old list).
  useEffect(() => {
    if (!pendingScan.current) return;
    pendingScan.current = false;
    void scan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletsVersion]);

  function onWalletsChanged() {
    pendingScan.current = true;
    setWalletsVersion((v) => v + 1);
  }

  const signableWallets = wallets.wallets.filter((w) => signableAddress(w));

  async function verify(walletId: string) {
    const wallet = wallets.wallets.find((w) => w.id === walletId);
    if (!wallet) return;
    setSigningIn(true);
    setSignInError(null);
    try {
      setSession(await signIn(wallet));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSignInError(/reject|denied|cancel/i.test(msg) ? "Signature cancelled in the wallet." : msg);
    } finally {
      setSigningIn(false);
    }
  }

  async function advise() {
    if (!portfolio) return;
    setAdvising(true);
    setAdviceError(null);
    try {
      const data = await postJson<{ advice: Advice; trades: Trade[]; market: MarketSnapshot }>("/api/advise", {
        holdings: portfolio.holdings,
        positions: portfolio.positions,
        personaId,
        risk,
        horizon,
        allowPerps,
      });
      setMarket(data.market);
      setResult({
        advice: data.advice,
        trades: data.trades,
        holdings: portfolio.holdings,
        steps: compilePlan(portfolio.holdings, data.trades),
        personaId,
      });
      // A fresh plan starts from zero.
      setProgress({});
      saveProgress({});
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/Verify a wallet/.test(msg)) setSession(null);
      setAdviceError(msg);
    } finally {
      setAdvising(false);
    }
  }

  function markDone(step: Step, txId?: string) {
    const next: Progress = { ...progress, [step.id]: { status: "done", txId, manual: step.kind === "manual", at: Date.now() } };
    setProgress(next);
    saveProgress(next);
    if (step.kind === "swap") void scan(true);
  }

  function openConnect() {
    setPickerSignal((n) => n + 1);
    walletsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const reviewWallet = review ? wallets.walletFor(review.address) : undefined;

  return (
    <main className="relative mx-auto w-full max-w-6xl px-4 pb-24 pt-8 sm:px-6 sm:pt-14">
      <nav className="mb-10 flex items-center justify-between sm:mb-12">
        <span className="font-serif text-2xl">Diversify</span>
        <span className="text-xs text-muted">
          <span className="hidden sm:inline">Educational analysis, </span>not financial advice
        </span>
      </nav>

      <header className="max-w-3xl">
        <h1 className="font-serif text-4xl leading-[1.02] tracking-tight sm:text-7xl">
          The best crypto strategy is to hold. <em className="text-accent">Are you holding the right assets?</em>
        </h1>
        <p className="mt-5 max-w-xl text-muted">
          Connect your wallets, pick a legendary investor&apos;s lens, and get a target allocation tuned to today&apos;s market, plus the swaps to get
          there, signed by you.
        </p>
      </header>

      <div ref={walletsRef} className="mt-10 grid scroll-mt-6 gap-5 sm:mt-12 lg:grid-cols-3">
        <WalletsPanel
          api={wallets}
          holdings={portfolio?.holdings ?? []}
          scanned={portfolio != null}
          scanning={scanning}
          scanError={scanError}
          onScan={() => void scan()}
          onWalletsChanged={onWalletsChanged}
          openPickerSignal={pickerSignal}
        />
        <MarketPanel market={market} error={marketError} />
      </div>

      {portfolio && (
        <div className="mt-5 grid gap-5 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <PortfolioView portfolio={portfolio} />
          </div>

          <Panel kicker="Step 2" title="Diversify like…">
            <div className="grid grid-cols-2 gap-2">
              {PERSONAS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPersonaId(p.id)}
                  className={`rounded-xl border p-3 text-left transition ${p.id === personaId ? "border-accent bg-accent/10" : "border-line hover:border-muted"}`}
                >
                  <span className="block text-sm font-medium">{p.name}</span>
                  <span className="mt-0.5 block text-xs leading-snug text-muted">{p.tagline}</span>
                </button>
              ))}
            </div>
            <p className="mt-5 mb-1.5 text-xs text-muted">Risk tolerance</p>
            <Segmented options={RISK_LEVELS} value={risk} onChange={setRisk} />
            <p className="mt-4 mb-1.5 text-xs text-muted">Horizon</p>
            <Segmented options={HORIZONS} value={horizon} onChange={setHorizon} />
            <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-sm">
              <input type="checkbox" checked={allowPerps} onChange={(e) => setAllowPerps(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
              <span>
                Allow perps
                <span className="block text-xs text-muted">1x longs on Hyperliquid (S&amp;P 500, Nasdaq, gold) when spot is too thin. They pay ongoing funding fees.</span>
              </span>
            </label>
            {session ? (
              <>
                <button
                  onClick={advise}
                  disabled={advising || portfolio.holdings.length === 0}
                  className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-ink py-3 font-medium text-bg transition hover:bg-accent disabled:opacity-40"
                >
                  {advising && <Spinner />}
                  {advising ? `Thinking like ${persona.name.split(" ")[1]}…` : `Diversify like ${persona.name.split(" ")[1]}`}
                </button>
                <p className="mt-2 text-center text-xs text-muted">
                  Verified as <span className="font-mono">{shortAddress(session.address)}</span> ·{" "}
                  <button onClick={() => signOut().then(() => setSession(null))} className="hover:text-ink">
                    sign out
                  </button>
                </p>
              </>
            ) : (
              <div className="mt-6 rounded-xl border border-line bg-bg/60 p-3">
                <p className="text-sm">Verify a wallet to run the advisor</p>
                <p className="mt-1 text-xs text-muted">
                  A free signature, no transaction. It proves the wallet is yours and keeps bots from burning the analysis budget.
                </p>
                {signableWallets.length === 0 ? (
                  <button onClick={openConnect} className="mt-3 w-full rounded-xl bg-ink py-2.5 text-sm font-medium text-bg hover:bg-accent">
                    Connect a wallet
                  </button>
                ) : (
                  <div className="mt-3 flex flex-col gap-2">
                    {signableWallets.map((w) => (
                      <button
                        key={w.id}
                        onClick={() => verify(w.id)}
                        disabled={signingIn}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-ink py-2.5 text-sm font-medium text-bg hover:bg-accent disabled:opacity-40"
                      >
                        {signingIn && <Spinner />}
                        Verify with {w.label}
                      </button>
                    ))}
                  </div>
                )}
                {signInError && <p className="mt-2 text-xs text-danger">{signInError}</p>}
              </div>
            )}
            {advising && <p className="mt-2 text-center text-xs text-muted">Deep analysis takes 30-90 seconds.</p>}
            {adviceError && <p className="mt-3 text-sm text-danger">{adviceError}</p>}
          </Panel>
        </div>
      )}

      {result && portfolio && (
        <div className="mt-10">
          <AdviceView
            advice={result.advice}
            trades={result.trades}
            holdings={result.holdings}
            persona={PERSONAS.find((p) => p.id === result.personaId)!}
            plan={
              <PlanView
                steps={result.steps}
                wallets={wallets}
                progress={progress}
                onReview={setReview}
                onMarkDone={(step) => markDone(step)}
                onConnect={openConnect}
              />
            }
          />
        </div>
      )}

      {review && reviewWallet && (
        <ReviewSheet
          step={review}
          wallet={reviewWallet}
          onClose={() => setReview(null)}
          onDone={(txId) => {
            markDone(review, txId);
            setReview(null);
          }}
        />
      )}

      <footer className="mt-16 border-t border-line pt-6 text-xs leading-relaxed text-muted">
        Diversify analyzes public on-chain balances and market data to produce educational allocation ideas. Swaps are routed through Jupiter and 0x and
        signed in your own wallet; Diversify charges a 0.5% fee on them and never holds your funds. Investor personas are inspired by publicly known
        philosophies and are not affiliated with or endorsed by those people. Nothing here is financial advice; crypto and tokenized assets can lose all
        their value.
      </footer>
    </main>
  );
}
