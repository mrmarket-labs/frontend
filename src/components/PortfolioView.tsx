import { CATEGORY_LABELS } from "@/lib/classify";
import type { PortfolioResponse } from "@/lib/types";
import { AllocationBar, CHAIN_LABELS, Legend, Panel, pct, sliceBy, usd } from "./ui";

const VISIBLE_ROWS = 12;

export function PortfolioView({ portfolio }: { portfolio: PortfolioResponse }) {
  const { holdings, positions = [], totalUsd, errors } = portfolio;
  const notional = positions.reduce((s, p) => s + p.notionalUsd, 0);
  const slices = sliceBy(holdings, (h) => h.category, (h) => h.valueUsd);
  const top = holdings.slice(0, VISIBLE_ROWS);
  const rest = holdings.slice(VISIBLE_ROWS);

  return (
    <Panel kicker="Your portfolio">
      <p className="num text-4xl tracking-tight">{usd(totalUsd)}</p>
      <p className="mt-1 text-sm text-muted">
        {holdings.length} position{holdings.length === 1 ? "" : "s"} across{" "}
        {new Set(holdings.map((h) => h.chain)).size} chain{new Set(holdings.map((h) => h.chain)).size === 1 ? "" : "s"}
      </p>

      <div className="mt-5">
        <AllocationBar slices={slices} />
        <Legend slices={slices} />
      </div>

      {holdings.length > 0 && (
        <div className="-mx-1 mt-6 overflow-x-auto">
          <table className="w-full min-w-[320px] text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-muted">
                <th className="px-1 pb-2 font-normal">Asset</th>
                <th className="px-1 pb-2 font-normal">Chain</th>
                <th className="hidden px-1 pb-2 font-normal sm:table-cell">Type</th>
                <th className="px-1 pb-2 text-right font-normal">Value</th>
                <th className="px-1 pb-2 text-right font-normal">Weight</th>
              </tr>
            </thead>
            <tbody>
              {top.map((h) => (
                <tr key={`${h.address}-${h.chain}-${h.symbol}`} className="border-t border-line">
                  <td className="px-1 py-2">
                    <div className="flex items-center gap-2">
                      {h.logo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={h.logo} alt="" className="size-5 rounded-full" />
                      ) : (
                        <span className="grid size-5 place-items-center rounded-full bg-surface-2 text-[9px]">{h.symbol.slice(0, 2)}</span>
                      )}
                      <span className="font-medium">{h.symbol}</span>
                    </div>
                  </td>
                  <td className="px-1 py-2 text-muted">{CHAIN_LABELS[h.chain]}</td>
                  <td className="hidden px-1 py-2 text-muted sm:table-cell">{CATEGORY_LABELS[h.category]}</td>
                  <td className="num px-1 py-2 text-right">{usd(h.valueUsd)}</td>
                  <td className="num px-1 py-2 text-right text-muted">{pct((h.valueUsd / totalUsd) * 100)}</td>
                </tr>
              ))}
              {rest.length > 0 && (
                <tr className="border-t border-line text-muted">
                  <td className="px-1 py-2" colSpan={2}>+ {rest.length} smaller positions</td>
                  <td className="hidden sm:table-cell" />
                  <td className="num px-1 py-2 text-right">{usd(rest.reduce((s, h) => s + h.valueUsd, 0))}</td>
                  <td />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {positions.length > 0 && (
        <div className="mt-6">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-medium">Leveraged perp positions</h3>
            <span className="num text-xs text-muted">
              {usd(notional)} notional · {totalUsd > 0 ? `${(notional / totalUsd).toFixed(1)}x` : "n/a"} your net worth
            </span>
          </div>
          <p className="mt-1 text-xs text-muted">Margin is already counted above; this is extra exposure on top.</p>
          <div className="-mx-1 mt-2 overflow-x-auto">
            <table className="w-full min-w-[320px] text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-muted">
                  <th className="px-1 pb-2 font-normal">Market</th>
                  <th className="px-1 pb-2 font-normal">Side</th>
                  <th className="px-1 pb-2 text-right font-normal">Notional</th>
                  <th className="px-1 pb-2 text-right font-normal">PnL</th>
                  <th className="px-1 pb-2 text-right font-normal">Liq. price</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => (
                  <tr key={`${p.venue}-${p.coin}`} className="border-t border-line">
                    <td className="px-1 py-2 font-medium">
                      {p.coin} <span className="num text-xs font-normal text-muted">{p.leverage}x</span>
                    </td>
                    <td className={`px-1 py-2 capitalize ${p.side === "long" ? "text-accent" : "text-danger"}`}>{p.side}</td>
                    <td className="num px-1 py-2 text-right">{usd(p.notionalUsd)}</td>
                    <td className={`num px-1 py-2 text-right ${p.unrealizedPnlUsd >= 0 ? "text-accent" : "text-danger"}`}>
                      {p.unrealizedPnlUsd >= 0 ? "+" : "−"}{usd(Math.abs(p.unrealizedPnlUsd))}
                    </td>
                    <td className="num px-1 py-2 text-right text-muted">{p.liquidationPx ? usd(p.liquidationPx) : "n/a"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {errors.length > 0 && (
        <ul className="mt-4 space-y-1 text-xs text-muted">
          {errors.map((e, i) => (
            <li key={i}>
              <span className="font-mono">{e.address.slice(0, 6)}…{e.address.slice(-4)}</span>: {e.message}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
