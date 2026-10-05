"use client";

import { useEffect, useRef, useState } from "react";
import type { Holding } from "@/lib/types";
import type { AddressKind, Wallet, WalletAddress } from "@/lib/wallets/types";
import { sameAddress, shortAddress } from "@/lib/wallets/types";
import type { WalletsApi } from "@/lib/wallets/useWallets";
import { Panel, Spinner, usd } from "./ui";

const KIND_LABELS: Record<AddressKind, string> = {
  solana: "Solana",
  evm: "Ethereum · L2s · Hyperliquid",
  bitcoin: "Bitcoin",
};

function WalletIcon({ wallet }: { wallet: Wallet }) {
  const letter = wallet.label.trim().charAt(0).toUpperCase() || "?";
  const color = wallet.provider === "phantom" ? "#ab9ff2" : wallet.mode === "connected" ? "#f2a541" : "var(--surface-2)";
  return (
    <span className="grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold" style={{ background: color, color: wallet.mode === "connected" ? "#0d0e0c" : "var(--muted)" }}>
      {wallet.mode === "watched" ? "👁" : letter}
    </span>
  );
}

export function WalletsPanel({ api, holdings, scanned, scanning, scanError, onScan, openPickerSignal }: {
  api: WalletsApi;
  holdings: Holding[];
  scanned: boolean;
  scanning: boolean;
  scanError: string | null;
  onScan: () => void;
  /** Bump to open the connect picker from elsewhere (e.g. "Connect to execute"). */
  openPickerSignal: number;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [watchOpen, setWatchOpen] = useState(false);
  const [watchText, setWatchText] = useState("");
  const [watchError, setWatchError] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (openPickerSignal > 0) setPickerOpen(true);
  }, [openPickerSignal]);

  useEffect(() => {
    if (!pickerOpen) return;
    const close = (e: MouseEvent) => {
      if (!pickerRef.current?.contains(e.target as Node)) setPickerOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [pickerOpen]);

  const valueOf = (a: WalletAddress) => holdings.filter((h) => sameAddress(h.address, a.address)).reduce((s, h) => s + h.valueUsd, 0);
  const walletTotal = (w: Wallet) => w.addresses.reduce((s, a) => s + valueOf(a), 0);

  async function connect(fn: () => Promise<void>) {
    setConnecting(true);
    setConnectError(null);
    try {
      await fn();
      setPickerOpen(false);
      onScan();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setConnectError(/reject|denied|cancel/i.test(msg) ? "Connection cancelled in the wallet." : msg);
    } finally {
      setConnecting(false);
    }
  }

  function addWatched() {
    const rejected = api.addWatched(watchText);
    if (rejected.length) setWatchError(`Not recognized: ${rejected.map(shortAddress).join(", ")}`);
    else {
      setWatchError(null);
      setWatchText("");
      setWatchOpen(false);
    }
  }

  const noExtensions = !api.phantomAvailable && api.evmWallets.length === 0;

  return (
    <Panel className="lg:col-span-2">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted">Step 1</p>
          <h2 className="font-serif text-2xl leading-tight">Your wallets</h2>
        </div>
        <div className="flex gap-2">
          <div className="relative" ref={pickerRef}>
            <button
              onClick={() => setPickerOpen((o) => !o)}
              className="rounded-xl bg-ink px-3.5 py-2 text-sm font-medium text-bg transition hover:bg-accent"
            >
              + Connect wallet
            </button>
            {pickerOpen && (
              <div className="absolute right-0 z-20 mt-2 w-72 rounded-xl border border-line bg-surface p-2 shadow-xl">
                {api.phantomAvailable && (
                  <button
                    disabled={connecting}
                    onClick={() => connect(api.connectPhantom)}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-surface-2 disabled:opacity-50"
                  >
                    <span className="grid size-8 place-items-center rounded-full bg-[#ab9ff2] text-sm font-bold text-bg">P</span>
                    <span>
                      <span className="block text-sm font-medium">Phantom</span>
                      <span className="block text-xs text-muted">Solana · Ethereum · Bitcoin in one connection</span>
                    </span>
                  </button>
                )}
                {api.evmWallets.map((w) => (
                  <button
                    key={w.rdns}
                    disabled={connecting}
                    onClick={() => connect(() => api.connectEvm(w.rdns))}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-surface-2 disabled:opacity-50"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={w.icon} alt="" className="size-8 rounded-full" />
                    <span>
                      <span className="block text-sm font-medium">{w.name}</span>
                      <span className="block text-xs text-muted">Ethereum, L2s and Hyperliquid</span>
                    </span>
                  </button>
                ))}
                {noExtensions && (
                  <p className="px-3 py-2 text-xs leading-relaxed text-muted">
                    No wallet extension found in this browser. Install Phantom or MetaMask, or watch an address instead.
                  </p>
                )}
                {connecting && <p className="flex items-center gap-2 px-3 py-2 text-xs text-muted"><Spinner /> Waiting for the wallet…</p>}
                {connectError && <p className="px-3 py-2 text-xs text-danger">{connectError}</p>}
              </div>
            )}
          </div>
          <button
            onClick={() => setWatchOpen((o) => !o)}
            className="rounded-xl border border-line px-3.5 py-2 text-sm text-ink transition hover:border-muted"
          >
            + Watch address
          </button>
        </div>
      </header>

      {watchOpen && (
        <div className="mb-4 rounded-xl border border-line bg-bg/60 p-3">
          <textarea
            value={watchText}
            onChange={(e) => setWatchText(e.target.value)}
            rows={2}
            spellCheck={false}
            autoFocus
            placeholder="Solana, Ethereum (0x…), Bitcoin address or xpub/zpub. One per line."
            className="w-full resize-y bg-transparent font-mono text-sm outline-none placeholder:text-muted/70"
          />
          <div className="mt-2 flex items-center gap-3">
            <button onClick={addWatched} disabled={!watchText.trim()} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-bg disabled:opacity-40">
              Add
            </button>
            <span className="text-xs text-muted">Read-only. Counts toward your portfolio; trades from it stay manual.</span>
          </div>
          {watchError && <p className="mt-2 text-xs text-danger">{watchError}</p>}
        </div>
      )}

      {api.ready && api.wallets.length === 0 && !watchOpen && (
        <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">
          Connect Phantom or another wallet, or paste an address to watch.
        </p>
      )}

      <ul className="divide-y divide-line">
        {api.wallets.map((w) => {
          const total = walletTotal(w);
          const visible = scanned && total > 0 ? w.addresses.filter((a) => valueOf(a) > 0) : w.addresses;
          return (
            <li key={w.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex items-center gap-3">
                <WalletIcon wallet={w} />
                {renaming === w.id ? (
                  <input
                    autoFocus
                    defaultValue={w.label}
                    onBlur={(e) => {
                      if (e.target.value.trim()) api.rename(w.id, e.target.value.trim());
                      setRenaming(null);
                    }}
                    onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                    className="rounded-md border border-line bg-bg px-2 py-0.5 text-sm outline-none focus:border-accent/60"
                  />
                ) : (
                  <button onClick={() => setRenaming(w.id)} title="Rename" className="text-sm font-medium hover:text-accent">
                    {w.label}
                  </button>
                )}
                <span className={`text-[11px] ${w.mode === "connected" ? "text-accent" : "text-muted"}`}>
                  {w.mode === "connected" ? "● Connected" : "○ Watch-only"}
                </span>
                <span className="ml-auto num text-sm">{scanned ? usd(total) : ""}</span>
                <button onClick={() => api.remove(w.id)} title="Remove" className="rounded-md px-1.5 text-muted hover:bg-surface-2 hover:text-danger">
                  ×
                </button>
              </div>
              <ul className="mt-1.5 space-y-1 pl-10 text-xs">
                {visible.map((a) => (
                  <li key={a.address} className="flex items-center gap-2">
                    <span className="w-24 shrink-0 truncate text-muted sm:w-40" title={KIND_LABELS[a.kind]}>
                      {KIND_LABELS[a.kind]}
                      {a.note && <span className="text-muted/70"> · {a.note}</span>}
                    </span>
                    <span className="whitespace-nowrap font-mono text-ink/80" title={a.address}>{shortAddress(a.address)}</span>
                    {scanned && <span className="ml-auto num text-muted">{usd(valueOf(a))}</span>}
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          onClick={onScan}
          disabled={scanning || api.wallets.length === 0}
          className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-accent px-5 py-2.5 font-medium text-bg transition hover:brightness-110 disabled:opacity-40"
        >
          {scanning && <Spinner />}
          {scanning ? "Scanning chains…" : scanned ? "Rescan portfolio" : "Analyze portfolio"}
        </button>
        <span className="text-xs text-muted">Read-only until you sign a trade. No keys ever leave your wallet.</span>
      </div>
      {scanError && <p className="mt-3 text-sm text-danger">{scanError}</p>}
    </Panel>
  );
}
