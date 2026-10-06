"use client";

import type { Holding } from "@/lib/types";
import { sameAddress, type Wallet } from "@/lib/wallets/types";
import { BTN_QUIET, SectionLabel, WalletMark, usd } from "./ui";

export type Tab = "portfolio" | "verdict" | "signals";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  {
    id: "portfolio",
    label: "Portfolio",
    icon: (
      <>
        <circle cx="10" cy="10" r="7.2" />
        <circle cx="10" cy="10" r="2.6" />
        <path d="M10 2.8v4.6" />
      </>
    ),
  },
  {
    id: "verdict",
    label: "Verdict",
    icon: (
      <>
        <path d="M4.5 3.5h11v13h-11z" />
        <path d="M7.2 7.5h6.6M7.2 10.5h6.6M7.2 13.5h3.8" />
      </>
    ),
  },
  {
    id: "signals",
    label: "Signals",
    icon: (
      <>
        <path d="M5.6 8.4a4.4 4.4 0 0 1 8.8 0c0 3.4 1.2 4.6 1.2 4.6H4.4s1.2-1.2 1.2-4.6z" />
        <path d="M8.4 15.6a1.8 1.8 0 0 0 3.2 0" />
      </>
    ),
  },
];

function TabIcon({ children, size }: { children: React.ReactNode; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      {children}
    </svg>
  );
}

/** Whose money is on screen: overlapping wallet marks and a count, tapping through to wallets. */
function WalletPill({ wallets, onClick }: { wallets: Wallet[]; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label="Manage wallets" className="flex h-tap items-center">
      <span className="flex h-8 items-center gap-2 rounded-pill bg-surface-control pr-3 pl-[7px] text-meta text-ink-2">
        <span className="flex">
          {wallets.slice(0, 3).map((w, i) => (
            <WalletMark key={w.id} wallet={w} size={19} className={i > 0 ? "-ml-1.5 shadow-[0_0_0_2px_var(--ground)]" : ""} />
          ))}
        </span>
        {wallets.length} wallet{wallets.length === 1 ? "" : "s"}
      </span>
    </button>
  );
}

/**
 * The app frame. Mobile: a title bar with the wallet pill and a fixed bottom tab bar.
 * Desktop: a left sidebar that lists the wallets in full. Same tabs, different bones.
 */
export function AppShell({ tab, title, wallets, holdings, onTab, onWallets, mobileAction, mobileBar, hideTabs = false, children }: {
  tab: Tab;
  /** Mobile top-bar title. */
  title: string;
  wallets: Wallet[];
  holdings: Holding[];
  onTab: (tab: Tab) => void;
  onWallets: () => void;
  /** Extra control beside the wallet pill on mobile (e.g. rescan). */
  mobileAction?: React.ReactNode;
  /** Replaces the mobile top bar on pages that are not tabs. */
  mobileBar?: React.ReactNode;
  hideTabs?: boolean;
  children: React.ReactNode;
}) {
  const walletTotal = (w: Wallet) =>
    holdings.filter((h) => w.addresses.some((a) => sameAddress(a.address, h.address))).reduce((s, h) => s + h.valueUsd, 0);

  return (
    <div className="flex min-h-dvh flex-1 flex-col lg:flex-row">
      <aside className="sticky top-0 hidden h-dvh w-sidebar flex-none flex-col gap-[30px] overflow-y-auto bg-ground-nav px-5 py-7 lg:flex">
        <span className="pl-2.5 font-display text-[21px]">Diversify</span>

        <nav className="flex flex-col gap-[3px]" aria-label="Main">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onTab(t.id)}
              aria-current={t.id === tab ? "page" : undefined}
              className={`flex h-tap items-center gap-3 rounded-nav px-3 text-[13.5px] transition-colors ${t.id === tab ? "bg-surface-nav-on text-ink" : "text-ink-3 hover:text-ink-2"}`}
            >
              <TabIcon size={18}>{t.icon}</TabIcon>
              {t.label}
            </button>
          ))}
        </nav>

        <div className="flex-1" />

        <div>
          <SectionLabel className="px-3 pb-2.5">Wallets</SectionLabel>
          <ul className="flex flex-col gap-0.5">
            {wallets.map((w) => (
              <li key={w.id} className="flex items-center gap-[11px] rounded-nav px-3 py-[9px]">
                <WalletMark wallet={w} size={22} />
                <span className="min-w-0 flex-1 truncate text-label">{w.label}</span>
                <span className="num text-meta text-ink-2">{usd(walletTotal(w))}</span>
              </li>
            ))}
          </ul>
          <button type="button" onClick={onWallets} className={`${BTN_QUIET} mt-2 h-tap w-full rounded-nav text-label`}>
            + Add wallet
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="mx-auto w-full max-w-[560px] px-gutter pt-4 lg:hidden">
          {mobileBar ?? (
            <div className="flex items-center justify-between">
              <span className="font-display text-wordmark text-ink-2">{title}</span>
              <span className="flex items-center gap-2">
                <WalletPill wallets={wallets} onClick={onWallets} />
                {mobileAction}
              </span>
            </div>
          )}
        </header>

        <main
          className={`mx-auto flex w-full max-w-[560px] flex-1 flex-col px-gutter pt-3 lg:max-w-none lg:px-gutter-lg lg:pt-9 lg:pb-11 ${hideTabs ? "pb-[26px]" : "pb-[calc(var(--tabbar)+22px)]"}`}
        >
          {children}
        </main>
      </div>

      {!hideTabs && (
        <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 bg-ground pt-2 pb-[max(16px,env(safe-area-inset-bottom))] lg:hidden">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onTab(t.id)}
              aria-current={t.id === tab ? "page" : undefined}
              className={`flex min-h-tap flex-col items-center justify-center gap-1.5 ${t.id === tab ? "text-ink" : "text-ink-4"}`}
            >
              <TabIcon size={19}>{t.icon}</TabIcon>
              <span className="text-tab">{t.label}</span>
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
