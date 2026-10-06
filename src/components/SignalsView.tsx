"use client";

import { useEffect, useState } from "react";
import { SIGNAL_GROUPS, SIGNALS, type SignalDef, type SignalId, type SignalReading, type SignalsResponse, type SignalStatus } from "@/lib/signals";
import { PageHeader, SectionLabel, Spinner, Toggle, shortDate } from "./ui";

const KEY = "diversify:signals";
const DEFAULT_ON = Object.fromEntries(SIGNALS.map((s) => [s.id, s.defaultOn])) as Record<SignalId, boolean>;

/** Delivery has no backend yet, so both channels are shown switched off and locked. */
const CHANNELS = ["Push", "Email"];

const DOT: Record<SignalStatus, string> = { fired: "bg-accent", close: "bg-warn", quiet: "bg-rule", unavailable: "bg-rule" };
const NOW: Record<SignalStatus, string> = { fired: "text-accent", close: "text-warn", quiet: "text-ink-2", unavailable: "text-ink-4" };

const fullDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

function loadOn(): Record<SignalId, boolean> {
  try {
    return { ...DEFAULT_ON, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}").on as Partial<Record<SignalId, boolean>>) };
  } catch {
    return DEFAULT_ON;
  }
}

export function SignalsView() {
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
        if (!r.ok) throw new Error(body.error ?? `Request failed (${r.status})`);
        setData(body as SignalsResponse);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
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
      <PageHeader title="Signals" sub="Pick what you want to hear about. We tell you when one fires — what you do about it is yours." />

      {loading && (
        <p className="mt-4 flex items-center gap-2 text-label text-ink-3">
          <Spinner /> Reading the market…
        </p>
      )}
      {error && <p className="mt-4 text-label text-risk">Signal readings are unavailable right now: {error}</p>}

      {live.length > 0 && (
        <div className="mt-5 flex flex-col gap-2.5 lg:mt-6.5">
          {live.map(({ def, reading }) => (
            <div key={def.id} className="flex items-center gap-3 rounded-card-sm border border-live bg-surface-live px-3.5 py-3 lg:flex-wrap lg:gap-3.5 lg:px-5 lg:py-4">
              <span className="size-[9px] flex-none rounded-full bg-accent" />
              <div className="min-w-0 flex-1 lg:flex lg:flex-none lg:flex-wrap lg:items-baseline lg:gap-x-3.5">
                <div className="text-body font-medium lg:text-row">{def.crossed}</div>
                <div className="num mt-0.5 text-meta text-accent-dim lg:mt-0 lg:text-label">
                  {reading.firedAt && `${shortDate(reading.firedAt)} · `}now {reading.now}
                  <span className="hidden lg:inline"> · fires {def.fires}</span>
                </div>
              </div>
              <span className="hidden flex-1 lg:block" />
              <span className="hidden text-label text-accent-text lg:block">A signal firing is information, not instruction.</span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-6.5 flex flex-col gap-6.5 lg:mt-8 lg:flex-row lg:flex-wrap lg:items-start lg:gap-gap-col">
        <div className="flex min-w-0 flex-col gap-6.5 lg:flex-[999_1_480px]">
          {SIGNAL_GROUPS.map((g) => {
            const items = SIGNALS.filter((s) => s.group === g.id);
            return (
              <section key={g.id}>
                <SectionLabel>{g.label}</SectionLabel>

                <ul className="mt-2 lg:hidden">
                  {items.map((s) => {
                    const r = readingOf(s.id);
                    return (
                      <li key={s.id} className="flex items-center gap-3 border-b border-hairline py-2">
                        <span className={`size-2 flex-none rounded-full ${DOT[statusOf(r)]}`} />
                        <div className="min-w-0 flex-1">
                          <div className="text-body font-medium">{s.name}</div>
                          <div className="num mt-0.5 text-meta text-ink-3">
                            fires {s.fires} ·{" "}
                            {noFeed(r) ? <span className="font-sans">no feed yet</span> : <span className={NOW[statusOf(r)]}>now {nowText(r)}</span>}
                          </div>
                        </div>
                        <Toggle on={on[s.id]} onChange={(v) => toggle(s.id, v)} label={s.name} />
                      </li>
                    );
                  })}
                </ul>

                <div className="hidden overflow-x-auto lg:block">
                  <table className="mt-1.5 w-full table-fixed border-collapse text-left">
                    <thead>
                      <tr className="text-meta text-ink-4">
                        <th className="py-2 font-normal">Signal</th>
                        <th className="w-[26%] py-2 font-normal">Fires</th>
                        <th className="w-[14%] py-2 text-right font-normal">Now</th>
                        <th className="w-[88px] py-2 text-right font-normal">On</th>
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
            <SectionLabel>How we reach you</SectionLabel>
            <ul className="mt-2 lg:mt-1.5">
              {CHANNELS.map((name) => (
                <li key={name} className="flex items-center gap-3 border-b border-hairline py-2 lg:border-0 lg:py-1">
                  <div className="min-w-0 flex-1">
                    <div className="text-body font-medium lg:font-normal">{name}</div>
                    <div className="mt-0.5 text-meta text-ink-3 lg:text-ink-4">Not live yet</div>
                  </div>
                  <Toggle on={false} onChange={() => undefined} label={`${name} (not live yet)`} disabled />
                </li>
              ))}
            </ul>
            <p className="mt-3 text-meta leading-normal text-ink-3 lg:mt-2 lg:text-ink-4">For now signals show here when you open the app.</p>
          </section>

          <section className="lg:rounded-card-sm lg:bg-surface lg:px-5 lg:py-4.5">
            <SectionLabel>Fired before</SectionLabel>
            {data && data.fired.length > 0 ? (
              <ul className="mt-2.5 flex flex-col gap-2 lg:mt-3 lg:gap-2.5">
                {data.fired.map((f) => (
                  <li key={`${f.id}-${f.date}`} className="flex items-baseline gap-2.5">
                    <span className="min-w-0 flex-1 text-label text-ink-2">{f.name}</span>
                    <span className="num text-meta text-ink-3 lg:text-ink-4">{fullDate(f.date)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2.5 text-label text-ink-3 lg:mt-3">{loading ? "…" : "Nothing on record yet."}</p>
            )}
          </section>

          <p className="text-meta leading-normal text-ink-3 lg:text-ink-4">
            A signal firing is information, not instruction. We never move your money, and we never send price moves — your coins going up or down is not a
            signal.
          </p>
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
  const cell = "border-t border-hairline";
  return (
    <tr>
      <td className={`${cell} py-3.5 text-row`}>
        <span className="inline-flex items-center gap-2.5">
          <span className={`size-2 flex-none rounded-full ${DOT[status]}`} />
          {def.name}
          {noFeed && <span className="text-meta text-ink-4">no feed yet</span>}
        </span>
      </td>
      <td className={`${cell} num py-3.5 text-label text-ink-3`}>{def.fires}</td>
      <td className={`${cell} num py-3.5 text-right text-body ${NOW[status]}`}>{now}</td>
      <td className={cell}>
        <div className="flex justify-end">
          <Toggle on={on} onChange={onChange} label={def.name} />
        </div>
      </td>
    </tr>
  );
}
