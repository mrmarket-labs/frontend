"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnalyzeView } from "@/components/AnalyzeView";
import { AppShell, type Tab } from "@/components/AppShell";
import { ConnectView } from "@/components/ConnectView";
import { OutsideView } from "@/components/OutsideView";
import { PortfolioView } from "@/components/PortfolioView";
import { ReviewSheet } from "@/components/ReviewSheet";
import { SignalsView } from "@/components/SignalsView";
import { usd } from "@/components/ui";
import { VerdictView } from "@/components/VerdictView";
import type { Advice } from "@/lib/advisor";
import { errorMessage } from "@/lib/i18n";
import { useLocale } from "@/lib/i18n/context";
import type { Horizon, RiskLevel } from "@/lib/options";
import { loadOutside, outsideTotal, priceOutside, saveOutside, type OutsideHolding, type Rates } from "@/lib/outside";
import { PERSONAS } from "@/lib/personas";
import { compilePlan, type Step, type SwapStep } from "@/lib/plan";
import type { Trade } from "@/lib/rebalance";
import type { PortfolioResponse } from "@/lib/types";
import { loadVerdict, saveVerdict, type Verdict } from "@/lib/verdict";
import { loadProgress, saveProgress, type Progress } from "@/lib/wallets/progress";
import { getSession, signIn, signOut, signableAddress, type SessionInfo } from "@/lib/wallets/signin";
import { useWallets } from "@/lib/wallets/useWallets";

/** connect ──▶ portfolio ──▶ analyze ──▶ verdict; portfolio, verdict and signals are the tabs; outside is a side step. */
type View = "connect" | "outside" | "analyze" | Tab;

/** A failed API call: the server's message in the user's language, plus a code where it sends one. */
class ApiError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
  }
}

async function postJson<T>(url: string, body: unknown, fallback: (status: number) => string): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new ApiError(data.error ?? fallback(res.status), data.code);
  return data as T;
}

function LegalNote() {
  const { t } = useLocale();
  return <p className="text-meta leading-relaxed text-ink-4">{t.legal}</p>;
}

export default function Home() {
  const { locale, t } = useLocale();
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

  // Money the app cannot see: stated by hand, priced with rates the server fetches.
  const [outside, setOutside] = useState<OutsideHolding[]>([]);
  // The outside step is reached from the portfolio or from analyze; "Done" returns to whichever.
  const outsideFrom = useRef<View>("portfolio");
  const [fx, setFx] = useState<Rates | null>(null);
  const [fxError, setFxError] = useState(false);

  const [session, setSession] = useState<SessionInfo | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress>({});
  const pendingScan = useRef<"stay" | "open" | null>(null);
  const [walletsVersion, setWalletsVersion] = useState(0);
  const [review, setReview] = useState<SwapStep | null>(null);

  const titles: Record<Tab, string> = { portfolio: t.common.appName, verdict: t.common.verdict, signals: t.common.signals };

  const go = useCallback((next: View) => {
    setView(next);
    window.history.pushState({ view: next }, "", `#${next}`);
    window.scrollTo(0, 0);
  }, []);

  const loadFx = useCallback(async (): Promise<Rates | null> => {
    setFxError(false);
    try {
      const res = await fetch("/api/fx");
      const data = (await res.json()) as { rates?: Rates };
      if (!res.ok || !data.rates) throw new Error("fx");
      setFx(data.rates);
      return data.rates;
    } catch {
      setFxError(true);
      return null;
    }
  }, []);

  useEffect(() => {
    // Saved state is only knowable in the browser; the last verdict stays on file between visits.
    /* eslint-disable react-hooks/set-state-in-effect */
    setProgress(loadProgress());
    setOutside(loadOutside());
    void loadFx();
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
  }, [loadFx]);

  function openOutside(from: View) {
    outsideFrom.current = from;
    go("outside");
  }

  function changeOutside(items: OutsideHolding[]) {
    setOutside(items);
    saveOutside(items);
  }

  const addresses = wallets.allAddresses;

  const scan = useCallback(
    async (open = false) => {
      if (addresses.length === 0) return;
      setScanning(true);
      setScanError(null);
      try {
        setPortfolio(await postJson<PortfolioResponse>("/api/portfolio", { addresses: addresses.join("\n") }, t.common.requestFailed));
        if (open) go("portfolio");
      } catch (e) {
        setScanError(errorMessage(e, t));
      } finally {
        setScanning(false);
      }
    },
    [addresses, go, t],
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
      const msg = errorMessage(e, t);
      setSignInError(/reject|denied|cancel/i.test(msg) ? t.analyze.signatureCancelled : msg);
    } finally {
      setSigningIn(false);
    }
  }

  async function advise() {
    if (!portfolio) return;
    setAdvising(true);
    setAdviceError(null);
    try {
      // Outside amounts are stated in euros or coins; fix them in dollars now, with fresh rates if needed.
      const rates = outside.length > 0 ? (fx ?? (await loadFx())) : {};
      const priced = priceOutside(outside, rates ?? {});
      if (priced.length < outside.length) throw new Error(t.outside.ratesFailed);
      const data = await postJson<{ advice: Advice; trades: Trade[] }>(
        "/api/advise",
        { holdings: portfolio.holdings, positions: portfolio.positions, outside: priced, personaId, risk, horizon, allowPerps },
        t.common.requestFailed,
      );
      const next: Verdict = {
        advice: data.advice,
        trades: data.trades,
        holdings: portfolio.holdings,
        outside: priced,
        steps: compilePlan(portfolio.holdings, data.trades, t),
        personaId,
        risk,
        horizon,
        locale,
        at: Date.now(),
      };
      setVerdict(next);
      saveVerdict(next);
      // A fresh plan starts from zero.
      setProgress({});
      saveProgress({});
      go("verdict");
    } catch (e) {
      if (e instanceof ApiError && e.code === "auth") setSession(null);
      setAdviceError(errorMessage(e, t));
    } finally {
      setAdvising(false);
    }
  }

  // Step ids are language-free, so the plan is re-worded in the current language on every render
  // and progress ticked off in one language still shows in the other.
  const shownVerdict = useMemo(() => (verdict ? { ...verdict, steps: compilePlan(verdict.holdings, verdict.trades, t) } : null), [verdict, t]);

  function markDone(step: Step, txId?: string) {
    const next: Progress = { ...progress, [step.id]: { status: "done", txId, manual: step.kind === "manual", at: Date.now() } };
    setProgress(next);
    saveProgress(next);
    if (step.kind === "swap") void scan();
  }

  const reviewWallet = review ? wallets.walletFor(review.address) : undefined;
  // Every screen past connect is about a scanned portfolio.
  const shown: View = portfolio ? view : "connect";
  const outsidePriced = priceOutside(outside, fx ?? {});
  const outsideUsd = outsidePriced.length === outside.length ? outsideTotal(outsidePriced) : null;

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

  const isStep = shown === "analyze" || shown === "outside";
  const tab: Tab = isStep ? "portfolio" : shown;

  return (
    <>
      <AppShell
        tab={tab}
        title={titles[tab]}
        wallets={wallets.wallets}
        holdings={portfolio.holdings}
        onTab={go}
        onWallets={() => go("connect")}
        hideTabs={isStep}
        mobileAction={
          shown === "portfolio" ? (
            <button type="button" aria-label={t.shell.rescan} disabled={scanning} onClick={() => void scan()} className="flex size-tap items-center justify-center disabled:opacity-40">
              <span className={`flex size-8 items-center justify-center rounded-full bg-surface-control font-mono text-body text-ink-2 ${scanning ? "animate-spin" : ""}`}>↻</span>
            </button>
          ) : undefined
        }
        mobileBar={
          isStep ? (
            <div className="flex items-center justify-between">
              <button type="button" aria-label={t.shell.backToPortfolio} onClick={() => go("portfolio")} className="flex size-tap items-center">
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
            outside={outsidePriced}
            onOutside={() => openOutside("portfolio")}
          />
        )}
        {shown === "outside" && (
          <OutsideView
            items={outside}
            onChange={changeOutside}
            rates={fx}
            ratesError={fxError}
            onRetryRates={() => void loadFx()}
            onChainUsd={portfolio.totalUsd}
            onContinue={() => go(outsideFrom.current)}
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
            outside={outside.length > 0 ? { usd: outsideUsd, count: outside.length } : null}
            onOutside={() => openOutside("analyze")}
            canAdvise={portfolio.holdings.length > 0}
            advising={advising}
            adviceError={adviceError}
            onAdvise={advise}
          />
        )}
        {shown === "verdict" && (
          <>
            <VerdictView
              verdict={shownVerdict}
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
