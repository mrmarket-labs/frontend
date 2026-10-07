"use client";

import { useT } from "@/lib/i18n/context";
import { HORIZONS, RISK_LEVELS, type Horizon, type RiskLevel } from "@/lib/options";
import { PERSONAS } from "@/lib/personas";
import type { SessionInfo } from "@/lib/wallets/signin";
import { shortAddress, type Wallet } from "@/lib/wallets/types";
import { BTN_PRIMARY, BTN_TONAL, SectionLabel, Spinner, Toggle } from "./ui";

function Segmented<T extends string>({ label, options, names, value, onChange, disabled }: {
  label: string;
  options: readonly T[];
  names: Record<T, string>;
  value: T;
  onChange: (v: T) => void;
  disabled: boolean;
}) {
  return (
    <div>
      <SectionLabel>{label}</SectionLabel>
      <div role="group" aria-label={label} className="mt-2 grid grid-cols-3 gap-1 rounded-input bg-surface-track p-1">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            aria-pressed={value === o}
            disabled={disabled}
            onClick={() => onChange(o)}
            className={`h-10 rounded-lg text-label font-medium transition-colors ${value === o ? "bg-ink text-ground" : "text-ink-2 hover:text-ink"}`}
          >
            {names[o]}
          </button>
        ))}
      </div>
    </div>
  );
}

export function AnalyzeView({
  personaId, risk, horizon, allowPerps, onPersona, onRisk, onHorizon, onPerps,
  session, signableWallets, signingIn, signInError, onVerify, onSignOut, onWallets,
  canAdvise, advising, adviceError, onAdvise,
}: {
  personaId: string;
  risk: RiskLevel;
  horizon: Horizon;
  allowPerps: boolean;
  onPersona: (id: string) => void;
  onRisk: (r: RiskLevel) => void;
  onHorizon: (h: Horizon) => void;
  onPerps: (on: boolean) => void;
  session: SessionInfo | null;
  signableWallets: Wallet[];
  signingIn: boolean;
  signInError: string | null;
  onVerify: (walletId: string) => void;
  onSignOut: () => void;
  onWallets: () => void;
  canAdvise: boolean;
  advising: boolean;
  adviceError: string | null;
  onAdvise: () => void;
}) {
  const t = useT();
  const persona = PERSONAS.find((p) => p.id === personaId) ?? PERSONAS[0];
  const named = (id: string) => t.personas[id as keyof typeof t.personas];
  const lens = named(persona.id)?.short ?? persona.name.split(" ").at(-1)!;

  return (
    <div className="flex w-full max-w-[640px] flex-1 flex-col">
      <h1 className="font-display text-display leading-[1.05] lg:text-page-title">
        {t.analyze.titleLead}<span className="text-ink-2 italic">{t.analyze.titleTail}</span>
      </h1>
      <p className="mt-2 text-label leading-normal text-ink-2">{t.analyze.intro}</p>

      <div className="mt-5 grid grid-cols-2 gap-[9px] sm:grid-cols-3">
        {PERSONAS.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={p.id === personaId}
            disabled={advising}
            onClick={() => onPersona(p.id)}
            className={`min-h-[92px] rounded-control border p-3 text-left transition-colors ${p.id === personaId ? "border-live bg-surface-live" : "border-transparent bg-surface-input"}`}
          >
            <span className="block text-row font-semibold tracking-[-0.1px]">{named(p.id)?.name ?? p.name}</span>
            <span className="mt-[5px] block text-meta leading-[1.35] text-ink-2">{named(p.id)?.tagline ?? p.tagline}</span>
          </button>
        ))}
      </div>

      <div className="mt-[26px] flex flex-col gap-[18px]">
        <Segmented label={t.analyze.riskTolerance} options={RISK_LEVELS} names={t.risk} value={risk} onChange={onRisk} disabled={advising} />
        <Segmented label={t.analyze.horizon} options={HORIZONS} names={t.horizon} value={horizon} onChange={onHorizon} disabled={advising} />

        <div className="flex items-start gap-3">
          <Toggle on={allowPerps} onChange={onPerps} label={t.analyze.allowPerpsToggle} disabled={advising} />
          <div className="pt-1">
            <div className="text-body font-medium">{t.analyze.allowPerps}</div>
            <div className="mt-[3px] text-meta leading-[1.4] text-ink-2">{t.analyze.allowPerpsNote}</div>
          </div>
        </div>
      </div>

      <div className="min-h-[26px] flex-1" />

      {session ? (
        <div>
          <button type="button" onClick={onAdvise} disabled={advising || !canAdvise} className={`${BTN_PRIMARY} h-[52px] w-full`}>
            {advising ? <Spinner /> : <span className="font-mono">◴</span>}
            {advising ? t.analyze.thinking(lens) : t.analyze.think(lens)}
          </button>
          <p className="mt-2.5 text-center text-meta text-ink-3">{advising ? t.analyze.takesTimeKeepOpen : t.analyze.takesTime}</p>
          {adviceError && <p role="alert" className="mt-2.5 text-center text-body text-risk">{adviceError}</p>}
          {!advising && (
            <p className="mt-2.5 text-center text-meta text-ink-3">
              {t.analyze.verifiedAs} <span className="num">{shortAddress(session.address)}</span> ·{" "}
              <button type="button" onClick={onSignOut} className="text-ink-2 underline underline-offset-2 hover:text-ink">
                {t.analyze.signOut}
              </button>
            </p>
          )}
        </div>
      ) : (
        <div className="rounded-card-sm bg-surface p-4">
          <div className="text-body font-medium">{t.analyze.verifyTitle}</div>
          <p className="mt-1 text-meta leading-normal text-ink-2">{t.analyze.verifyNote}</p>
          <div className="mt-3.5 flex flex-col gap-2">
            {signableWallets.length === 0 ? (
              <button type="button" onClick={onWallets} className={`${BTN_PRIMARY} h-[52px] w-full`}>
                {t.analyze.connectWallet}
              </button>
            ) : (
              signableWallets.map((w, i) => (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => onVerify(w.id)}
                  disabled={signingIn}
                  className={i === 0 ? `${BTN_PRIMARY} h-[52px] w-full` : `${BTN_TONAL} h-tap w-full`}
                >
                  {signingIn && i === 0 && <Spinner />}
                  {t.analyze.verifyWith(w.label)}
                </button>
              ))
            )}
          </div>
          {signInError && <p role="alert" className="mt-2.5 text-meta text-risk">{signInError}</p>}
        </div>
      )}
    </div>
  );
}
