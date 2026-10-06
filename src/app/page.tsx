"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnalyzeView } from "@/components/AnalyzeView";
import { AppShell, type Tab } from "@/components/AppShell";
import { ConnectView } from "@/components/ConnectView";
import { PortfolioView } from "@/components/PortfolioView";
import { ReviewSheet } from "@/components/ReviewSheet";
import { SignalsView } from "@/components/SignalsView";
import { usd } from "@/components/ui";
import { VerdictView } from "@/components/VerdictView";
import type { Advice } from "@/lib/advisor";
import type { Horizon, RiskLevel } from "@/lib/options";
import { PERSONAS } from "@/lib/personas";
import { compilePlan, type Step, type SwapStep } from "@/lib/plan";
import type { Trade } from "@/lib/rebalance";
import type { PortfolioResponse } from "@/lib/types";
import { loadVerdict, saveVerdict, type Verdict } from "@/lib/verdict";
import { loadProgress, saveProgress, type Progress } from "@/lib/wallets/progress";
import { getSession, signIn, signOut, signableAddress, type SessionInfo } from "@/lib/wallets/signin";
import { useWallets } from "@/lib/wallets/useWallets";

/** connect ──▶ portfolio ──▶ analyze ──▶ verdict; portfolio, verdict and signals are the tabs. */
type View = "connect" | "analyze" | Tab;

const TITLES: Record<Tab, string> = { portfolio: "Diversify", verdict: "Verdict", signals: "Signals" };

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

function LegalNote() {
  return (
    <p className="text-meta leading-relaxed text-ink-4">
      Diversify analyzes public on-chain balances and market data to produce educational allocation ideas. Swaps are routed through Jupiter and 0x and
      signed in your own wallet; Diversify charges a 0.5% fee on them and never holds your funds. Investor lenses are inspired by publicly known
      philosophies and are not affiliated with or endorsed by those people. Nothing here is financial advice; crypto and tokenized assets can lose all
      their value.
    </p>
  );
}

export default function Home() {
  const wallets = useWallets();
  const [view, setView] = useState<View>("connect");
  const [portfolio, setPortfolio] = useState<PortfolioResponse | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const [personaId, setPersonaId] = useState(PERSONAS[0].id);
  const [risk, setRisk] = useState<RiskLevel>("balanced");
  const [horizon, setHorizon] = useState<Horizon>("3+ years");
  const [allowPerps, setAllowPerps] = useState(false);
  const [advising, setAdvising] = useState(false);
  const [adviceError, setAdviceError] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);

  const [session, setSession] = useState<SessionInfo | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress>({});
  const pendingScan = useRef<"stay" | "open" | null>(null);
  const [walletsVersion, setWalletsVersion] = useState(0);
  const [review, setReview] = useState<SwapStep | null>(null);

  const go = useCallback((next: View) => {
    setView(next);
    window.history.pushState({ view: next }, "", `#${next}`);
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    // Saved state is only knowable in the browser; the last verdict stays on file between visits.
    /* eslint-disable react-hooks/set-state-in-effect */
    setProgress(loadProgress());
    const saved = loadVerdict();
    if (saved) {
      setVerdict(saved);
      setPersonaId(saved.personaId);
      setRisk(saved.risk);
      setHorizon(saved.horizon);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
    getSession().then(setSession).catch(() => undefined);
    const onPop = (e: PopStateEvent) => setView((e.state as { view?: View } | null)?.view ?? "connect");
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const addresses = wallets.allAddresses;

  const scan = useCallback(
    async (open = false) => {
      if (addresses.length === 0) return;
      setScanning(true);
      setScanError(null);
      try {
        setPortfolio(await postJson<PortfolioResponse>("/api/portfolio", { addresses: addresses.join("\n") }));
        if (open) go("portfolio");
      } catch (e) {
        setScanError(e instanceof Error ? e.message : String(e));
      } finally {
        setScanning(false);
      }
    },
    [addresses, go],
  );

  // The address list only settles after a connect/merge finishes, so scan from an effect
  // instead of from the click handler (which would see the old list).
  useEffect(() => {
    const pending = pendingScan.current;
    if (!pending) return;
    pendingScan.current = null;
    void scan(pending === "open");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletsVersion]);

  // Returning visitors already have wallets on file: looking costs nothing, so look straight away.
  useEffect(() => {
    if (!wallets.ready || wallets.wallets.length === 0) return;
    pendingScan.current = "open";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWalletsVersion((v) => v + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallets.ready]);

  function onWalletsChanged() {
    pendingScan.current = "stay";
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
      const data = await postJson<{ advice: Advice; trades: Trade[] }>("/api/advise", {
        holdings: portfolio.holdings,
        positions: portfolio.positions,
        personaId,
        risk,
        horizon,
        allowPerps,
      });
      const next: Verdict = {
        advice: data.advice,
        trades: data.trades,
        holdings: portfolio.holdings,
        steps: compilePlan(portfolio.holdings, data.trades),
        personaId,
        risk,
        horizon,
        at: Date.now(),
      };
      setVerdict(next);
      saveVerdict(next);
      // A fresh plan starts from zero.
      setProgress({});
      saveProgress({});
      go("verdict");
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
    if (step.kind === "swap") void scan();
  }

  const reviewWallet = review ? wallets.walletFor(review.address) : undefined;
  // Every screen past connect is about a scanned portfolio.
  const shown: View = portfolio ? view : "connect";

  if (shown === "connect" || !portfolio)
    return (
      <ConnectView
        api={wallets}
        holdings={portfolio?.holdings ?? []}
        scanned={portfolio != null}
        scanning={scanning}
        scanError={scanError}
        onScan={() => void scan(true)}
        onWalletsChanged={onWalletsChanged}
        onBack={portfolio ? () => go("portfolio") : undefined}
        footer={<LegalNote />}
      />
    );

  const tab: Tab = shown === "analyze" ? "portfolio" : shown;

  return (
    <>
      <AppShell
        tab={tab}
        title={TITLES[tab]}
        wallets={wallets.wallets}
        holdings={portfolio.holdings}
        onTab={go}
        onWallets={() => go("connect")}
        hideTabs={shown === "analyze"}
        mobileAction={
          shown === "portfolio" ? (
            <button type="button" aria-label="Rescan portfolio" disabled={scanning} onClick={() => void scan()} className="flex size-tap items-center justify-center disabled:opacity-40">
              <span className={`flex size-8 items-center justify-center rounded-full bg-surface-control font-mono text-body text-ink-2 ${scanning ? "animate-spin" : ""}`}>↻</span>
            </button>
          ) : undefined
        }
        mobileBar={
          shown === "analyze" ? (
            <div className="flex items-center justify-between">
              <button type="button" aria-label="Back to portfolio" onClick={() => go("portfolio")} className="flex size-tap items-center">
                <span className="flex size-[34px] items-center justify-center rounded-full bg-surface-control font-mono text-row">←</span>
              </button>
              <span className="num text-label text-ink-2">{usd(portfolio.totalUsd)}</span>
              <span className="w-tap" />
            </div>
          ) : undefined
        }
      >
        {shown === "portfolio" && (
          <PortfolioView
            portfolio={portfolio}
            lastRead={verdict ? { at: verdict.at, personaId: verdict.personaId } : null}
            scanning={scanning}
            onRescan={() => void scan()}
            onAnalyze={() => go("analyze")}
          />
        )}
        {shown === "analyze" && (
          <AnalyzeView
            personaId={personaId}
            risk={risk}
            horizon={horizon}
            allowPerps={allowPerps}
            onPersona={setPersonaId}
            onRisk={setRisk}
            onHorizon={setHorizon}
            onPerps={setAllowPerps}
            session={session}
            signableWallets={signableWallets}
            signingIn={signingIn}
            signInError={signInError}
            onVerify={verify}
            onSignOut={() => signOut().then(() => setSession(null))}
            onWallets={() => go("connect")}
            canAdvise={portfolio.holdings.length > 0}
            advising={advising}
            adviceError={adviceError}
            onAdvise={advise}
          />
        )}
        {shown === "verdict" && (
          <>
            <VerdictView
              verdict={verdict}
              wallets={wallets}
              progress={progress}
              onReview={setReview}
              onMarkDone={(step) => markDone(step)}
              onWallets={() => go("connect")}
              onAnalyze={() => go("analyze")}
              onSignals={() => go("signals")}
            />
            {verdict && (
              <div className="mt-[26px] max-w-[46em]">
                <LegalNote />
              </div>
            )}
          </>
        )}
        {shown === "signals" && <SignalsView />}
      </AppShell>

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
    </>
  );
}
