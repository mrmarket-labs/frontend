import { CATEGORY_LABELS } from "@/lib/classify";
import type { Category } from "@/lib/types";
export { CHAIN_LABELS } from "@/lib/chain-labels";

export const CATEGORY_COLORS: Record<Category, string> = {
  stablecoin: "#9db4c8",
  bitcoin: "#f2a541",
  ethereum: "#8f9cff",
  solana: "#4fd1c5",
  "large-cap": "#e37fa0",
  "tokenized-stock": "#8ed47e",
  "tokenized-gold": "#d9bd5c",
  speculative: "#ef6a5e",
};

export const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n < 100 ? 2 : 0 });

export const pct = (n: number, digits = 1) => `${n.toFixed(digits)}%`;

export const signed = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

export function Panel({ title, kicker, children, className = "" }: {
  title?: string;
  kicker?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-line bg-surface/80 p-5 sm:p-6 ${className}`}>
      {(kicker || title) && (
        <header className="mb-4">
          {kicker && <p className="text-[11px] uppercase tracking-[0.18em] text-muted">{kicker}</p>}
          {title && <h2 className="font-serif text-2xl leading-tight">{title}</h2>}
        </header>
      )}
      {children}
    </section>
  );
}

export interface Slice {
  category: Category;
  pct: number;
}

/** Stacked horizontal bar of category weights. */
export function AllocationBar({ slices, label }: { slices: Slice[]; label?: string }) {
  return (
    <div>
      {label && <p className="mb-1.5 text-xs text-muted">{label}</p>}
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-2">
        {slices.filter((s) => s.pct > 0).map((s) => (
          <div
            key={s.category}
            title={`${CATEGORY_LABELS[s.category]} ${pct(s.pct)}`}
            style={{ width: `${s.pct}%`, background: CATEGORY_COLORS[s.category] }}
            className="h-full border-r border-bg/60 last:border-r-0"
          />
        ))}
      </div>
    </div>
  );
}

export function Legend({ slices }: { slices: Slice[] }) {
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
      {slices.filter((s) => s.pct > 0).map((s) => (
        <li key={s.category} className="flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: CATEGORY_COLORS[s.category] }} />
          <span className="text-muted">{CATEGORY_LABELS[s.category]}</span>
          <span className="num">{s.pct < 1 ? "<1%" : pct(s.pct, 0)}</span>
        </li>
      ))}
    </ul>
  );
}

export function sliceBy<T>(items: T[], category: (t: T) => Category, weight: (t: T) => number): Slice[] {
  const total = items.reduce((s, t) => s + weight(t), 0) || 1;
  const sums = new Map<Category, number>();
  for (const t of items) sums.set(category(t), (sums.get(category(t)) ?? 0) + weight(t));
  return (Object.keys(CATEGORY_LABELS) as Category[])
    .map((c) => ({ category: c, pct: ((sums.get(c) ?? 0) / total) * 100 }))
    .filter((s) => s.pct > 0);
}

export function Spinner() {
  return <span className="inline-block size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" />;
}
