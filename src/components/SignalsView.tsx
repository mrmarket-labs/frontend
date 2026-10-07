"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/context";
import { SIGNAL_GROUPS, SIGNALS, type SignalDef, type SignalId, type SignalReading, type SignalsResponse, type SignalStatus } from "@/lib/signals";
import { PageHeader, SectionLabel, Spinner, Toggle, shortDate } from "./ui";

const KEY = "diversify:signals";
const DEFAULT_ON = Object.fromEntries(SIGNALS.map((s) => [s.id, s.defaultOn])) as Record<SignalId, boolean>;

/** Delivery has no backend yet, so both channels are shown switched off and locked. */
const CHANNELS = ["push", "email"] as const;

const DOT: Record<SignalStatus, string> = { fired: "bg-accent", close: "bg-warn", quiet: "bg-rule", unavailable: "bg-rule" };
const NOW: Record<SignalStatus, string> = { fired: "text-accent", close: "text-warn", quiet: "text-ink-2", unavailable: "text-ink-4" };

function loadOn(): Record<SignalId, boolean> {
  try {
    return { ...DEFAULT_ON, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}").on as Partial<Record<SignalId, boolean>>) };
  } catch {
    return DEFAULT_ON;
  }
}

export function SignalsView() {
  const t = useT();
  const [on, setOn] = useState(DEFAULT_ON);
  const [data, setData] = useState<SignalsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // What the user follows lives on this device and is only knowable in the browser.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOn(loadOn());
    fetch("/api/signals")
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? t.common.requestFailed(r.status));
        setData(body as SignalsResponse);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle(id: SignalId, value: boolean) {
    const next = { ...on, [id]: value };
    setOn(next);
    try {
      localStorage.setItem(KEY, JSON.stringify({ on: next }));
    } catch {}
  }

  const loading = !data && !error;
  const readingOf = (id: SignalId): SignalReading | undefined => data?.readings.find((r) => r.id === id);
  const words = (id: SignalId) => t.signals.defs[id];
  const live = SIGNALS.flatMap((s) => {
    const reading = readingOf(s.id);
    return reading?.status === "fired" && on[s.id] ? [{ def: s, reading }] : [];
  });

  /** The current reading, or what stands in for it while there is none. */
  const nowText = (r: SignalReading | undefined) => r?.now ?? (loading ? "…" : "—");
  const statusOf = (r: SignalReading | undefined): SignalStatus => r?.status ?? "unavailable";
  const noFeed = (r: SignalReading | undefined) => r?.status === "unavailable";

  return (
    <div>
      <PageHeader title={t.signalsView.title} sub={t.signalsView.intro} />

      {loading && (
        <p className="mt-4 flex items-center gap-2 text-label text-ink-3">
          <Spinner /> {t.signalsView.reading}
        </p>
      )}
      {error && <p className="mt-4 text-label text-risk">{t.signalsView.unavailable(error)}</p>}

      {live.length > 0 && (
        <div className="mt-5 flex flex-col gap-2.5 lg:mt-6.5">
          {live.map(({ def, reading }) => (
            <div key={def.id} className="flex items-center gap-3 rounded-card-sm border border-live bg-surface-live px-3.5 py-3 lg:flex-wrap lg:gap-3.5 lg:px-5 lg:py-4">
              <span className="size-[9px] flex-none rounded-full bg-accent" />
              <div className="min-w-0 flex-1 lg:flex lg:flex-none lg:flex-wrap lg:items-baseline lg:gap-x-3.5">
                <div className="text-body font-medium lg:text-row">{words(def.id).crossed}</div>
                <div className="num mt-0.5 text-meta text-accent-dim lg:mt-0 lg:text-label">
                  {reading.firedAt && `${shortDate(reading.firedAt, t)} · `}
                  {t.signalsView.now(reading.now ?? "")}
                  <span className="hidden lg:inline"> · {t.signalsView.fires(words(def.id).fires)}</span>
                </div>
              </div>
              <span className="hidden flex-1 lg:block" />
              <span className="hidden text-label text-accent-text lg:block">{t.signalsView.information}</span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-6.5 flex flex-col gap-6.5 lg:mt-8 lg:flex-row lg:flex-wrap lg:items-start lg:gap-gap-col">
        <div className="flex min-w-0 flex-col gap-6.5 lg:flex-[999_1_480px]">
          {SIGNAL_GROUPS.map((g) => {
            const items = SIGNALS.filter((s) => s.group === g);
            return (
              <section key={g}>
                <SectionLabel>{t.signals.groups[g]}</SectionLabel>

                <ul className="mt-2 lg:hidden">
                  {items.map((s) => {
                    const r = readingOf(s.id);
                    return (
                      <li key={s.id} className="flex items-center gap-3 border-b border-hairline py-2">
                        <span className={`size-2 flex-none rounded-full ${DOT[statusOf(r)]}`} />
                        <div className="min-w-0 flex-1">
                          <div className="text-body font-medium">{words(s.id).name}</div>
                          <div className="num mt-0.5 text-meta text-ink-3">
                            {t.signalsView.fires(words(s.id).fires)} ·{" "}
                            {noFeed(r) ? <span className="font-sans">{t.signalsView.noFeed}</span> : <span className={NOW[statusOf(r)]}>{t.signalsView.now(nowText(r))}</span>}
                          </div>
                        </div>
                        <Toggle on={on[s.id]} onChange={(v) => toggle(s.id, v)} label={words(s.id).name} />
                      </li>
                    );
                  })}
                </ul>

                <div className="hidden overflow-x-auto lg:block">
                  <table className="mt-1.5 w-full table-fixed border-collapse text-left">
                    <thead>
                      <tr className="text-meta text-ink-4">
                        <th className="py-2 font-normal">{t.signalsView.colSignal}</th>
                        <th className="w-[26%] py-2 font-normal">{t.signalsView.colFires}</th>
                        <th className="w-[14%] py-2 text-right font-normal">{t.signalsView.colNow}</th>
                        <th className="w-[88px] py-2 text-right font-normal">{t.signalsView.colOn}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((s) => {
                        const r = readingOf(s.id);
                        return <SignalRow key={s.id} def={s} status={statusOf(r)} now={nowText(r)} noFeed={noFeed(r)} on={on[s.id]} onChange={(v) => toggle(s.id, v)} />;
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>

        <div className="flex min-w-0 flex-col gap-6.5 lg:flex-[0_1_300px]">
          <section className="lg:rounded-card-sm lg:bg-surface lg:px-5 lg:py-4.5">
            <SectionLabel>{t.signalsView.howWeReachYou}</SectionLabel>
            <ul className="mt-2 lg:mt-1.5">
              {CHANNELS.map((id) => (
                <li key={id} className="flex items-center gap-3 border-b border-hairline py-2 lg:border-0 lg:py-1">
                  <div className="min-w-0 flex-1">
                    <div className="text-body font-medium lg:font-normal">{t.signalsView.channels[id]}</div>
                    <div className="mt-0.5 text-meta text-ink-3 lg:text-ink-4">{t.signalsView.notLive}</div>
                  </div>
                  <Toggle on={false} onChange={() => undefined} label={t.signalsView.channelLabel(t.signalsView.channels[id])} disabled />
                </li>
              ))}
            </ul>
            <p className="mt-3 text-meta leading-normal text-ink-3 lg:mt-2 lg:text-ink-4">{t.signalsView.forNow}</p>
          </section>

          <section className="lg:rounded-card-sm lg:bg-surface lg:px-5 lg:py-4.5">
            <SectionLabel>{t.signalsView.firedBefore}</SectionLabel>
            {data && data.fired.length > 0 ? (
              <ul className="mt-2.5 flex flex-col gap-2 lg:mt-3 lg:gap-2.5">
                {data.fired.map((f) => (
                  <li key={`${f.id}-${f.date}`} className="flex items-baseline gap-2.5">
                    <span className="min-w-0 flex-1 text-label text-ink-2">{words(f.id).name}</span>
                    <span className="num text-meta text-ink-3 lg:text-ink-4">{t.common.fullDate(new Date(f.date))}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2.5 text-label text-ink-3 lg:mt-3">{loading ? "…" : t.signalsView.nothingOnRecord}</p>
            )}
          </section>

          <p className="text-meta leading-normal text-ink-3 lg:text-ink-4">{t.signalsView.footer}</p>
        </div>
      </div>
    </div>
  );
}

function SignalRow({ def, status, now, noFeed, on, onChange }: {
  def: SignalDef;
  status: SignalStatus;
  now: string;
  noFeed: boolean;
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  const t = useT();
  const words = t.signals.defs[def.id];
  const cell = "border-t border-hairline";
  return (
    <tr>
      <td className={`${cell} py-3.5 text-row`}>
        <span className="inline-flex items-center gap-2.5">
          <span className={`size-2 flex-none rounded-full ${DOT[status]}`} />
          {words.name}
          {noFeed && <span className="text-meta text-ink-4">{t.signalsView.noFeed}</span>}
        </span>
      </td>
      <td className={`${cell} num py-3.5 text-label text-ink-3`}>{words.fires}</td>
      <td className={`${cell} num py-3.5 text-right text-body ${NOW[status]}`}>{now}</td>
      <td className={cell}>
        <div className="flex justify-end">
          <Toggle on={on} onChange={onChange} label={words.name} />
        </div>
      </td>
    </tr>
  );
}
