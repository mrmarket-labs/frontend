import type { MarketSnapshot } from "@/lib/types";
import { Panel, signed } from "./ui";

const REGIME_STYLES = {
  "risk-on": { label: "Risk-on", className: "bg-accent/15 text-accent" },
  neutral: { label: "Neutral", className: "bg-ink/10 text-ink" },
  "risk-off": { label: "Risk-off", className: "bg-danger/15 text-danger" },
};

export function MarketPanel({ market, error }: { market: MarketSnapshot | null; error: string | null }) {
  if (error) return <Panel kicker="Market conditions"><p className="text-sm text-danger">{error}</p></Panel>;
  if (!market)
    return (
      <Panel kicker="Market conditions">
        <div className="h-40 animate-pulse rounded-xl bg-surface-2" />
      </Panel>
    );

  const regime = REGIME_STYLES[market.regime];
  return (
    <Panel kicker="Market conditions">
      <div className="flex items-baseline justify-between gap-3">
        <span className={`rounded-full px-3 py-1 text-sm font-medium ${regime.className}`}>{regime.label}</span>
        <span className="num text-xs text-muted">score {market.regimeScore}</span>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
        <div>
          <dt className="text-xs text-muted">Fear &amp; Greed</dt>
          <dd className="num mt-0.5 text-lg">
            {market.fearGreed ? `${market.fearGreed.value}` : "n/a"}
            <span className="ml-1.5 font-sans text-xs text-muted">{market.fearGreed?.label}</span>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">BTC dominance</dt>
          <dd className="num mt-0.5 text-lg">{market.btcDominance != null ? `${market.btcDominance.toFixed(1)}%` : "n/a"}</dd>
        </div>
      </dl>

      <table className="mt-5 w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wider text-muted">
            <th className="pb-2 font-normal">Asset</th>
            <th className="pb-2 text-right font-normal">30d</th>
            <th className="pb-2 text-right font-normal">vs 200d</th>
            <th className="pb-2 text-right font-normal">Vol</th>
          </tr>
        </thead>
        <tbody className="num">
          {market.assets.map((a) => (
            <tr key={a.symbol} className="border-t border-line">
              <td className="py-2 font-sans">{a.symbol}</td>
              <td className={`py-2 text-right ${a.change30d >= 0 ? "text-accent" : "text-danger"}`}>{signed(a.change30d)}</td>
              <td className={`py-2 text-right ${a.vsSma200 >= 0 ? "text-accent" : "text-danger"}`}>{signed(a.vsSma200)}</td>
              <td className="py-2 text-right text-muted">{a.volatility30d.toFixed(0)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
