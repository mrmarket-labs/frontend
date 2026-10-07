import type { Dict } from "@/lib/i18n";
import type { Category } from "@/lib/types";
import type { Wallet } from "@/lib/wallets/types";

/** Dollar amounts keep the "$1,234" shape in every language: it is how prices read in crypto. */
export const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n < 100 ? 2 : 0 });

export const pct = (n: number, digits = 1) => `${n.toFixed(digits)}%`;

export const signed = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

/** "6 Oct" / "10月6日", with the year once it is no longer this one. */
export function shortDate(at: number | string | Date, t: Dict): string {
  const d = new Date(at);
  return t.common.shortDate(d, d.getFullYear() === new Date().getFullYear());
}

/* --- Chart classes ---------------------------------------------------------
   The design has six chart colours; the eight holding categories fold into them. */

export type ChartKey = "eth" | "btc" | "stable" | "stocks" | "sol" | "alts";

export const CHART: Record<ChartKey, { color: string }> = {
  eth: { color: "var(--c-eth)" },
  btc: { color: "var(--c-btc)" },
  stable: { color: "var(--c-stable)" },
  stocks: { color: "var(--c-stocks)" },
  sol: { color: "var(--c-sol)" },
  alts: { color: "var(--c-alts)" },
};

const CHART_KEY: Record<Category, ChartKey> = {
  ethereum: "eth",
  bitcoin: "btc",
  stablecoin: "stable",
  "tokenized-stock": "stocks",
  "tokenized-gold": "stocks",
  solana: "sol",
  "large-cap": "alts",
  speculative: "alts",
};

export const chartKey = (category: Category): ChartKey => CHART_KEY[category];
export const chartColor = (category: Category): string => CHART[CHART_KEY[category]].color;

export interface Slice {
  key: ChartKey;
  label: string;
  chip: string;
  color: string;
  pct: number;
  /** Sum of the weights as given (USD for holdings, percent for targets). */
  weight: number;
}

/** Roll items up into chart classes, largest first, named in the current language. */
export function sliceBy<T>(items: T[], category: (t: T) => Category, weight: (t: T) => number, names: Dict["chart"]): Slice[] {
  const total = items.reduce((s, t) => s + weight(t), 0) || 1;
  const sums = new Map<ChartKey, number>();
  const gold = new Set<ChartKey>();
  for (const t of items) {
    const key = chartKey(category(t));
    sums.set(key, (sums.get(key) ?? 0) + weight(t));
    if (category(t) === "tokenized-gold" && weight(t) > 0) gold.add(key);
  }
  return [...sums.entries()]
    .filter(([, w]) => w > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([key, w]) => ({
      key,
      ...CHART[key],
      ...(gold.has(key) ? names.stocksGold : names[key]),
      pct: (w / total) * 100,
      weight: w,
    }));
}

/**
 * One ring of a donut. Render inside `<svg><g transform="rotate(-90 c c)" fill="none">`.
 * With `picked` set, every other arc drops back.
 */
export function Ring({ c, r, width, slices, opacity = 1, picked = null, track = "var(--c-track)" }: {
  c: number;
  r: number;
  width: number;
  slices: Slice[];
  opacity?: number;
  picked?: ChartKey | null;
  track?: string;
}) {
  const len = 2 * Math.PI * r;
  const gap = slices.length > 1 ? 3 : 0;
  const arcs = slices.map((s) => (s.pct / 100) * len);
  const starts = arcs.map((_, i) => arcs.slice(0, i).reduce((a, b) => a + b, 0));
  return (
    <>
      <circle cx={c} cy={c} r={r} stroke={track} strokeWidth={width} />
      {slices.map((s, i) => (
        <circle
          key={s.key}
          cx={c}
          cy={c}
          r={r}
          stroke={s.color}
          strokeWidth={width}
          strokeDasharray={`${Math.max(arcs[i] - gap, Math.min(arcs[i], 2))} ${len}`}
          strokeDashoffset={-starts[i]}
          opacity={picked === null || picked === s.key ? opacity : opacity * 0.18}
          className="transition-opacity"
        />
      ))}
    </>
  );
}

/* --- Wallet marks ---------------------------------------------------------- */

export function walletTone(wallet: Pick<Wallet, "provider" | "mode">): { bg: string; ink: string } {
  if (wallet.provider === "phantom") return { bg: "var(--w-phantom)", ink: "var(--w-phantom-ink)" };
  if (wallet.provider === "okx") return { bg: "var(--w-okx)", ink: "var(--w-okx-ink)" };
  if (wallet.provider === "binance") return { bg: "var(--w-binance)", ink: "var(--w-binance-ink)" };
  if (wallet.provider?.toLowerCase().includes("metamask")) return { bg: "var(--w-metamask)", ink: "var(--w-metamask-ink)" };
  return { bg: "var(--surface-raised)", ink: wallet.mode === "connected" ? "var(--text)" : "var(--text-2)" };
}

/** The round initial that stands for a wallet everywhere it is mentioned. */
export function WalletMark({ wallet, size = 22, className = "" }: { wallet: Pick<Wallet, "provider" | "mode" | "label">; size?: number; className?: string }) {
  const tone = walletTone(wallet);
  return (
    <span
      aria-hidden
      className={`flex flex-none items-center justify-center rounded-full font-semibold ${className}`}
      style={{ width: size, height: size, background: tone.bg, color: tone.ink, fontSize: Math.round(size * 0.46) }}
    >
      {wallet.label.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

/* --- Controls -------------------------------------------------------------- */

/** Primary action: the accent's first job. One per screen. */
export const BTN_PRIMARY =
  "flex items-center justify-center gap-2 rounded-control bg-accent text-[15px] font-semibold text-accent-ink transition hover:brightness-105 disabled:opacity-40";
/** Secondary action: tonal, never outlined. */
export const BTN_TONAL =
  "flex items-center justify-center gap-2 rounded-nav bg-surface-raised text-body font-medium text-ink transition hover:brightness-125 disabled:opacity-40";
/** Quiet action on the page ground (rescan, run again, add wallet). */
export const BTN_QUIET =
  "flex items-center justify-center gap-2 rounded-input bg-surface-control text-body text-ink-2 transition hover:text-ink disabled:opacity-40";

export function Toggle({ on, onChange, label, disabled = false }: { on: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="flex h-tap w-[46px] flex-none items-center justify-center disabled:opacity-40"
    >
      <span className={`flex h-[25px] w-[42px] items-center rounded-pill px-[3px] transition-colors ${on ? "justify-end bg-accent" : "justify-start bg-surface-raised"}`}>
        <span className={`block size-[17px] rounded-full ${on ? "bg-surface-live" : "bg-ink-3"}`} />
      </span>
    </button>
  );
}

/** Section label: sentence case, never all-caps. */
export function SectionLabel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`text-label text-ink-3 ${className}`}>{children}</div>;
}

/**
 * Page title row. On mobile the shell's top bar already carries the title, so only the
 * supporting line (and any actions) render; desktop gets the serif heading.
 */
export function PageHeader({ title, sub, children }: { title: string; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        <h1 className="hidden font-display text-page-title leading-[1.1] lg:block">{title}</h1>
        {sub && <p className="text-label leading-normal text-ink-2 lg:mt-1.5 lg:text-ink-3">{sub}</p>}
      </div>
      {children && <div className="flex items-center gap-2.5">{children}</div>}
    </div>
  );
}

export function Spinner() {
  return <span className="inline-block size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" />;
}
