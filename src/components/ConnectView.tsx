"use client";

import { useState } from "react";
import { errorMessage } from "@/lib/i18n";
import { useT } from "@/lib/i18n/context";
import type { Holding } from "@/lib/types";
import type { Wallet, WalletAddress } from "@/lib/wallets/types";
import { sameAddress, shortAddress } from "@/lib/wallets/types";
import { MOBILE_WALLETS, openInWallet } from "@/lib/wallets/mobile";
import { chainsOf, type DiscoveredWallet } from "@/lib/wallets/registry";
import type { WalletsApi } from "@/lib/wallets/useWallets";
import { LanguageSwitch } from "./LanguageSwitch";
import { BTN_PRIMARY, BTN_TONAL, SectionLabel, Spinner, WalletMark, usd } from "./ui";

const INPUT = "w-full rounded-input bg-surface-input px-3 text-body outline-none placeholder:text-ink-3 focus-visible:outline-2";

/** Everything that changes a wallet lives behind its row, so the list itself stays a list. */
function ManageWallet({ wallet, api, connected, onChanged, onClose, startAdding }: {
  wallet: Wallet;
  api: WalletsApi;
  connected: Wallet[];
  onChanged: () => void;
  onClose: () => void;
  startAdding: boolean;
}) {
  const t = useT();
  const [addText, setAddText] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  function add() {
    const rejected = api.addAddressesTo(wallet.id, addText);
    if (rejected.length) return setAddError(t.connect.notRecognized(rejected.map(shortAddress).join(", ")));
    setAddError(null);
    setAddText("");
    onChanged();
    onClose();
  }

  return (
    <div className="mt-3 ml-[41px] flex flex-col gap-2.5">
      <label className="block">
        <span className="text-meta text-ink-3">{t.connect.name}</span>
        <input
          defaultValue={wallet.label}
          onBlur={(e) => e.target.value.trim() && api.rename(wallet.id, e.target.value.trim())}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          className={`${INPUT} mt-1 h-tap`}
        />
      </label>
      <label className="block">
        <span className="text-meta text-ink-3">{t.connect.addAddress}</span>
        <span className="mt-1 flex gap-2">
          <input
            autoFocus={startAdding}
            value={addText}
            onChange={(e) => setAddText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addText.trim() && add()}
            spellCheck={false}
            placeholder={wallet.provider === "phantom" ? t.connect.placeholderPhantomBtc : t.connect.placeholderAddress}
            className={`${INPUT} num h-tap min-w-0 flex-1`}
          />
          <button type="button" onClick={add} disabled={!addText.trim()} className={`${BTN_TONAL} h-tap px-4`}>
            {t.connect.add}
          </button>
        </span>
      </label>
      {addError && <p role="alert" className="text-meta text-risk">{addError}</p>}
      {wallet.mode === "watched" && connected.length > 0 && (
        <label className="block">
          <span className="text-meta text-ink-3">{t.connect.belongsTo}</span>
          <select
            value=""
            onChange={(e) => e.target.value && api.attachWallet(wallet.id, e.target.value)}
            className={`${INPUT} mt-1 h-tap`}
          >
            <option value="">{t.connect.attachTo}</option>
            {connected.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </label>
      )}
      <button
        type="button"
        onClick={() => {
          api.remove(wallet.id);
          onChanged();
        }}
        className="h-tap self-start text-body text-ink-2 underline underline-offset-2 hover:text-ink"
      >
        {t.connect.removeWallet}
      </button>
    </div>
  );
}

/**
 * Onboarding, and the place wallets are managed afterwards. Read-only until a signature is
 * required: connecting or watching only ever reads public balances.
 */
export function ConnectView({ api, holdings, scanned, scanning, scanError, onScan, onWalletsChanged, onBack, footer }: {
  api: WalletsApi;
  holdings: Holding[];
  scanned: boolean;
  scanning: boolean;
  scanError: string | null;
  onScan: () => void;
  /** Fired after a connect or watch adds addresses; the parent rescans once state has settled. */
  onWalletsChanged: () => void;
  /** Present once there is a portfolio to go back to. */
  onBack?: () => void;
  footer?: React.ReactNode;
}) {
  const t = useT();
  const [panel, setPanel] = useState<"picker" | "watch" | null>(null);
  const [watchText, setWatchText] = useState("");
  const [watchError, setWatchError] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connectHint, setConnectHint] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [managing, setManaging] = useState<{ id: string; adding: boolean } | null>(null);

  const valueOf = (a: WalletAddress) => holdings.filter((h) => sameAddress(h.address, a.address)).reduce((s, h) => s + h.valueUsd, 0);
  const walletTotal = (w: Wallet) => w.addresses.reduce((s, a) => s + valueOf(a), 0);
  const total = holdings.reduce((s, h) => s + h.valueUsd, 0);

  /** "Solana · Ethereum · Bitcoin in one connection", in the current language. */
  const speaks = (w: DiscoveredWallet) =>
    t.connect.chainsOf(
      chainsOf(w).map((c) => (c === "solana" ? t.chains.solana : c === "evm" ? t.chains.ethereum : c === "evm-only" ? t.connect.evmFull : t.chains.bitcoin)),
    );

  async function connect(key: string, name: string) {
    setConnecting(true);
    setConnectError(null);
    setConnectHint(null);
    try {
      const added = await api.connect(key);
      // Newer Phantom builds no longer hand out Bitcoin addresses to websites.
      if (key === "phantom" && added.some((a) => a.kind === "solana") && !added.some((a) => a.kind === "bitcoin")) {
        setConnectHint(t.connect.phantomBtcHint(name));
        setManaging({ id: `conn:${key}`, adding: true });
      }
      setPanel(null);
      onWalletsChanged();
    } catch (e) {
      const msg = errorMessage(e, t);
      setConnectError(/reject|denied|cancel/i.test(msg) ? t.connect.connectionCancelled : msg);
    } finally {
      setConnecting(false);
    }
  }

  function addWatched() {
    const rejected = api.addWatched(watchText, t.connect.watchedLabel);
    if (rejected.length) return setWatchError(t.connect.notRecognized(rejected.map(shortAddress).join(", ")));
    setWatchError(null);
    setWatchText("");
    setPanel(null);
    onWalletsChanged();
  }

  const connected = api.wallets.filter((w) => w.mode === "connected");
  const noExtensions = api.available.length === 0;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-1 flex-col lg:grid lg:max-w-[1040px] lg:grid-cols-[minmax(0,1fr)_440px] lg:content-center lg:items-center lg:gap-x-gap-col lg:px-gutter-lg lg:py-11">
      <div>
        <div className="flex items-center justify-between px-gutter pt-6 lg:px-0 lg:pt-0">
          <span className="font-display text-wordmark">{t.common.appName}</span>
          <span className="flex items-center gap-3">
            <LanguageSwitch />
            {onBack ? (
              <button type="button" onClick={onBack} className="-my-3 h-tap text-body text-ink-2 hover:text-ink">
                <span className="font-mono">←</span> {t.connect.backToPortfolio}
              </button>
            ) : (
              <span className="text-meta text-ink-4">{t.common.notFinancialAdvice}</span>
            )}
          </span>
        </div>

        <div className="px-gutter pt-[34px] lg:px-0 lg:pt-14">
          <h1 className="font-display text-display leading-[1.02] tracking-[-0.2px] lg:text-hero-lg">{t.connect.heroLine1}</h1>
          <p className="mt-1 font-display text-display leading-[1.02] text-accent italic lg:text-hero-lg">{t.connect.heroLine2}</p>
          <p className="mt-4 max-w-[34em] text-body leading-normal text-ink-2">{t.connect.intro}</p>
        </div>
        {footer && <div className="mt-10 hidden max-w-[34em] lg:block">{footer}</div>}
      </div>

      <div className="flex flex-1 flex-col lg:flex-none">
        <div className="mx-gutter mt-7 flex flex-1 flex-col rounded-card bg-surface p-4 lg:mx-0 lg:mt-0 lg:min-h-[420px]">
          <div className="flex items-center justify-between">
            <SectionLabel>{t.connect.yourWallets}</SectionLabel>
            {scanned && <span className="num text-meta">{usd(total)}</span>}
          </div>

          {api.ready && api.wallets.length === 0 && <p className="mt-3.5 text-body leading-normal text-ink-2">{t.connect.empty}</p>}

          <ul>
            {api.wallets.map((w, i) => {
              const kinds = [...new Set(w.addresses.map((a) => a.kind))];
              const worth = walletTotal(w);
              const visible = scanned && worth > 0 ? w.addresses.filter((a) => valueOf(a) > 0) : w.addresses;
              const open = managing?.id === w.id;
              return (
                <li key={w.id} className={i > 0 ? "mt-3.5 border-t border-hairline pt-3.5" : "mt-3.5"}>
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setManaging(open ? null : { id: w.id, adding: false })}
                    className="flex w-full items-center gap-[11px] text-left"
                  >
                    <WalletMark wallet={w} size={30} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-row font-medium">{w.label}</span>
                      <span className="block truncate text-meta text-ink-2">{kinds.map((k) => t.kinds[k]).join(" · ")}</span>
                    </span>
                    <span className="text-right">
                      {scanned && <span className="num block text-row">{usd(worth)}</span>}
                      <span className={`block text-meta ${w.mode === "connected" ? "text-accent" : "text-ink-3"}`}>
                        {w.mode === "connected" ? t.connect.connected : t.connect.watchOnly}
                      </span>
                    </span>
                  </button>
                  <ul className="mt-2.5 ml-[41px] flex flex-col gap-[5px]">
                    {visible.map((a) => (
                      <li key={a.address} className="num flex justify-between text-meta text-ink-3" title={a.address}>
                        <span>
                          {shortAddress(a.address)}
                          {a.note && <span className="font-sans"> · {a.note}</span>}
                        </span>
                        {scanned && visible.length > 1 && <span>{usd(valueOf(a))}</span>}
                      </li>
                    ))}
                  </ul>
                  {open && (
                    <ManageWallet
                      wallet={w}
                      api={api}
                      connected={connected}
                      onChanged={onWalletsChanged}
                      onClose={() => {
                        setManaging(null);
                        setConnectHint(null);
                      }}
                      startAdding={managing.adding}
                    />
                  )}
                </li>
              );
            })}
          </ul>

          {connectHint && <p className="mt-3.5 rounded-input bg-surface-control px-3 py-2.5 text-meta leading-normal text-ink-2">{connectHint}</p>}

          <div className="min-h-4 flex-1" />

          {panel === "picker" && (
            <div className="mb-2.5 flex flex-col gap-1">
              {api.available.map((w) => (
                <button
                  key={w.key}
                  type="button"
                  disabled={connecting}
                  onClick={() => connect(w.key, w.name)}
                  className="flex min-h-tap items-center gap-[11px] rounded-input bg-surface-input px-3 py-2 text-left disabled:opacity-40"
                >
                  <WalletMark wallet={{ provider: w.key, mode: "connected", label: w.name }} size={30} />
                  <span>
                    <span className="block text-row font-medium">{w.name}</span>
                    <span className="block text-meta text-ink-2">{speaks(w)}</span>
                  </span>
                </button>
              ))}
              {noExtensions && api.mobileLinks && (
                <>
                  <p className="text-meta leading-normal text-ink-2">{t.connect.mobileIntro}</p>
                  {MOBILE_WALLETS.map(({ id, label }) => (
                    <a
                      key={id}
                      href={api.mobileLinks![id].web}
                      onClick={(e) => {
                        e.preventDefault();
                        openInWallet(api.mobileLinks![id]);
                      }}
                      className="flex min-h-tap items-center gap-[11px] rounded-input bg-surface-input px-3 py-2"
                    >
                      <WalletMark wallet={{ provider: id, mode: "connected", label }} size={30} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-row font-medium">{t.connect.openIn(label)}</span>
                        <span className="block text-meta text-ink-2">{t.connect.mobileChains[id]}</span>
                      </span>
                      <span className="font-mono text-body text-ink-2">↗</span>
                    </a>
                  ))}
                  <p className="text-meta leading-normal text-ink-3">{t.connect.noAppHint}</p>
                </>
              )}
              {noExtensions && !api.mobileLinks && <p className="text-meta leading-normal text-ink-2">{t.connect.noExtension}</p>}
              {connecting && (
                <p className="flex items-center gap-2 text-meta text-ink-2">
                  <Spinner /> {t.connect.waiting}
                </p>
              )}
              {connectError && <p role="alert" className="text-meta text-risk">{connectError}</p>}
            </div>
          )}

          {panel === "watch" && (
            <div className="mb-2.5">
              <label className="block">
                <span className="text-meta text-ink-3">{t.connect.addressToWatch}</span>
                <textarea
                  value={watchText}
                  onChange={(e) => setWatchText(e.target.value)}
                  rows={2}
                  spellCheck={false}
                  autoFocus
                  placeholder={t.connect.watchPlaceholder}
                  className={`${INPUT} num mt-1 resize-y py-2.5`}
                />
              </label>
              <div className="mt-2 flex items-center gap-3">
                <button type="button" onClick={addWatched} disabled={!watchText.trim()} className={`${BTN_TONAL} h-tap px-4`}>
                  {t.connect.watch}
                </button>
                <span className="text-meta leading-normal text-ink-3">{t.connect.watchNote}</span>
              </div>
              {watchError && <p role="alert" className="mt-2 text-meta text-risk">{watchError}</p>}
            </div>
          )}

          <div className="flex gap-[9px]">
            <button type="button" aria-expanded={panel === "picker"} onClick={() => {
                if (panel !== "picker") api.refresh();
                setPanel(panel === "picker" ? null : "picker");
              }} className={`${BTN_TONAL} h-tap flex-1 rounded-input`}>
              {t.connect.addWalletButton}
            </button>
            <button type="button" aria-expanded={panel === "watch"} onClick={() => setPanel(panel === "watch" ? null : "watch")} className={`${BTN_TONAL} h-tap flex-1 rounded-input`}>
              {t.connect.watchAddressButton}
            </button>
          </div>
        </div>

        <div className="px-gutter pt-5 pb-[26px] lg:px-0 lg:pb-0">
          <button type="button" onClick={onScan} disabled={scanning || api.wallets.length === 0} className={`${BTN_PRIMARY} h-[52px] w-full`}>
            {scanning && <Spinner />}
            {scanning ? t.connect.scanning : scanned ? t.connect.rescan : t.connect.scan}
            {!scanning && <span className="font-mono">→</span>}
          </button>
          {scanError ? (
            <p role="alert" className="mt-2.5 text-center text-meta text-risk">{scanError}</p>
          ) : (
            <p className="mt-2.5 text-center text-meta text-ink-3">{t.connect.freeNote}</p>
          )}
          {footer && <div className="mt-6 lg:hidden">{footer}</div>}
        </div>
      </div>
    </div>
  );
}
