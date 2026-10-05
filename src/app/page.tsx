"use client";

import { useEffect, useState } from "react";
import { AdviceView } from "@/components/AdviceView";
import { MarketPanel } from "@/components/MarketPanel";
import { PortfolioView } from "@/components/PortfolioView";
import { Panel, Spinner } from "@/components/ui";
import type { Advice } from "@/lib/advisor";
import { HORIZONS, RISK_LEVELS, type Horizon, type RiskLevel } from "@/lib/options";
import { PERSONAS } from "@/lib/personas";
import type { Trade } from "@/lib/rebalance";
import type { MarketSnapshot, PortfolioResponse } from "@/lib/types";

const STORAGE_KEY = "diversify:addresses";
const LEGACY_STORAGE_KEY = "holdwise:addresses";

function detectChain(address: string): string | null {
  if (/^0x[0-9a-fA-F]{40}$/.test(address)) return "EVM · ETH, Base, Arbitrum, Optimism, Polygon, Hyperliquid";
  if (/^[xyz]pub[1-9A-HJ-NP-Za-km-z]{100,112}$/.test(address)) return "Bitcoin wallet (all addresses)";
  if (/^(bc1[02-9ac-hj-np-z]{11,87}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/.test(/^bc1/i.test(address) ? address.toLowerCase() : address))
    return address.toLowerCase().startsWith("bc1p") ? "Bitcoin (Taproot)" : "Bitcoin";
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return "Solana";
  return null;
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
  const [addressText, setAddressText] = useState("");
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
  const [result, setResult] = useState<{ advice: Advice; trades: Trade[]; personaId: string } | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
      // Read after mount (not in a lazy initializer) so server and client markup match.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved) setAddressText(saved);
    } catch {}
    fetch("/api/market")
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        setMarket(data);
      })
      .catch((e) => setMarketError(`Market data unavailable: ${e.message}`));
  }, []);

  const lines = addressText.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
  const persona = PERSONAS.find((p) => p.id === personaId)!;

  async function scan() {
    setScanning(true);
    setScanError(null);
    setResult(null);
    try {
      localStorage.setItem(STORAGE_KEY, addressText);
    } catch {}
    try {
      setPortfolio(await postJson<PortfolioResponse>("/api/portfolio", { addresses: addressText }));
    } catch (e) {
      setScanError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
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
      setResult({ advice: data.advice, trades: data.trades, personaId });
    } catch (e) {
      setAdviceError(e instanceof Error ? e.message : String(e));
    } finally {
      setAdvising(false);
    }
  }

  return (
    <main className="relative mx-auto w-full max-w-6xl px-4 pb-24 pt-10 sm:px-6 sm:pt-14">
      <nav className="mb-12 flex items-center justify-between">
        <span className="font-serif text-2xl">Diversify</span>
        <span className="text-xs text-muted">Educational analysis, not financial advice</span>
      </nav>

      <header className="max-w-3xl">
        <h1 className="font-serif text-5xl leading-[1.02] tracking-tight sm:text-7xl">
          The best crypto strategy is to hold. <em className="text-accent">Are you holding the right assets?</em>
        </h1>
        <p className="mt-5 max-w-xl text-muted">
          Paste your wallets, pick a legendary investor&apos;s lens, and get a target allocation tuned to today&apos;s market, plus the trades to get there.
        </p>
      </header>

      <div className="mt-12 grid gap-5 lg:grid-cols-3">
        <Panel kicker="Step 1" title="Your wallets" className="lg:col-span-2">
          <textarea
            value={addressText}
            onChange={(e) => setAddressText(e.target.value)}
            rows={4}
            spellCheck={false}
            placeholder={"One per line: Solana, Ethereum/L2/Hyperliquid (0x…), Bitcoin address (bc1…) or Bitcoin xpub/zpub"}
            className="w-full resize-y rounded-xl border border-line bg-bg/60 p-3.5 font-mono text-sm outline-none placeholder:text-muted/70 focus:border-accent/60"
          />
          {lines.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs">
              {lines.map((a) => {
                const chain = detectChain(a);
                return (
                  <li key={a} className="flex items-center gap-2">
                    <span className="font-mono text-muted">{a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a}</span>
                    <span className={chain ? "text-accent" : "text-danger"}>{chain ?? "unrecognized"}</span>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={scan}
              disabled={scanning || lines.length === 0}
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 font-medium text-bg transition hover:brightness-110 disabled:opacity-40"
            >
              {scanning && <Spinner />}
              {scanning ? "Scanning chains…" : "Analyze portfolio"}
            </button>
            <span className="text-xs text-muted">Read-only. No wallet connection, no keys.</span>
          </div>
          {scanError && <p className="mt-3 text-sm text-danger">{scanError}</p>}
        </Panel>

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
                  className={`rounded-xl border p-3 text-left transition ${
                    p.id === personaId ? "border-accent bg-accent/10" : "border-line hover:border-muted"
                  }`}
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
              <input
                type="checkbox"
                checked={allowPerps}
                onChange={(e) => setAllowPerps(e.target.checked)}
                className="mt-0.5 size-4 accent-[var(--accent)]"
              />
              <span>
                Allow perps
                <span className="block text-xs text-muted">1x longs on Hyperliquid (S&amp;P 500, Nasdaq, gold) when spot is too thin. They pay ongoing funding fees.</span>
              </span>
            </label>
            <button
              onClick={advise}
              disabled={advising || portfolio.holdings.length === 0}
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-ink py-3 font-medium text-bg transition hover:bg-accent disabled:opacity-40"
            >
              {advising && <Spinner />}
              {advising ? `Thinking like ${persona.name.split(" ")[1]}…` : `Diversify like ${persona.name.split(" ")[1]}`}
            </button>
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
            holdings={portfolio.holdings}
            persona={PERSONAS.find((p) => p.id === result.personaId)!}
          />
        </div>
      )}

      <footer className="mt-16 border-t border-line pt-6 text-xs leading-relaxed text-muted">
        Diversify analyzes public on-chain balances and market data to produce educational allocation ideas. Investor personas are inspired by publicly
        known philosophies and are not affiliated with or endorsed by those people. Nothing here is financial advice; crypto and tokenized assets can lose
        all their value.
      </footer>
    </main>
  );
}
