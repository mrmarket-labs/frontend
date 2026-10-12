"use client";

import { useState } from "react";
import { errorMessage } from "@/lib/i18n";
import { useT } from "@/lib/i18n/context";
import { MAX_LONG, MAX_SHORT, TRUST, WOULD_ACT, type FeedbackForm, type Trust, type WouldAct } from "@/lib/waitlist-options";
import { BTN_PRIMARY, BTN_QUIET, SectionLabel, Spinner } from "./ui";

const INPUT = "w-full rounded-input bg-surface-input px-3 text-body outline-none placeholder:text-ink-3 focus-visible:outline-2";

function Chip({ on, onClick, disabled, children }: { on: boolean; onClick: () => void; disabled: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={`min-h-10 rounded-control border px-3.5 py-2 text-label font-medium transition-colors ${on ? "border-live bg-surface-live text-ink" : "border-hairline bg-transparent text-ink-2 hover:text-ink"}`}
    >
      {children}
    </button>
  );
}

function Field({ label, optional, children }: { label: string; optional?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-meta text-ink-3">
        {label}
        {optional && <span className="ml-1.5 text-ink-4">{optional}</span>}
      </span>
      {children}
    </label>
  );
}

/**
 * The last step after a test analysis: what they thought, and the waitlist for Pro. One
 * submission per browser is remembered, so a returning visitor sees the thank-you instead.
 */
export function FeedbackView({ sent, onSubmit, onBack, onDone }: {
  /** Email of a submission already sent from this browser; null if none. */
  sent: string | null;
  onSubmit: (form: FeedbackForm) => Promise<void>;
  /** Back to the verdict. */
  onBack: () => void;
  /** After the thank-you: back to the portfolio. */
  onDone: () => void;
}) {
  const t = useT();
  const [form, setForm] = useState<FeedbackForm>({ email: "", trust: [] });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [again, setAgain] = useState(false);

  const set = <K extends keyof FeedbackForm>(key: K, value: FeedbackForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const toggleTrust = (x: Trust) => set("trust", form.trust.includes(x) ? form.trust.filter((y) => y !== x) : [...form.trust, x]);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!emailOk) return setError(t.feedback.emailRequired);
    setSending(true);
    setError(null);
    try {
      await onSubmit(form);
      setAgain(false);
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setSending(false);
    }
  }

  if (sent && !again)
    return (
      <div className="flex w-full max-w-[560px] flex-1 flex-col">
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-surface-live px-2.5 py-1 text-meta text-accent-text">● {t.feedback.earlyAccess}</span>
        <h1 className="mt-4 font-display text-display leading-[1.05] lg:text-page-title">{t.feedback.thanksTitle}</h1>
        <p className="mt-3 max-w-[32em] text-body leading-relaxed text-ink-2">{t.feedback.thanksIntro(sent)}</p>
        <div className="mt-6 flex flex-wrap gap-2.5">
          <button type="button" onClick={onDone} className={`${BTN_PRIMARY} h-[52px] px-7`}>
            {t.feedback.backToPortfolio} <span className="font-mono">→</span>
          </button>
          <button type="button" onClick={() => setAgain(true)} className={`${BTN_QUIET} h-[52px] px-5`}>
            {t.feedback.sendAnother}
          </button>
        </div>
      </div>
    );

  return (
    <form onSubmit={submit} className="flex w-full max-w-[640px] flex-1 flex-col">
      <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-surface-live px-2.5 py-1 text-meta text-accent-text">● {t.feedback.earlyAccess}</span>
      <h1 className="mt-4 font-display text-display leading-[1.05] lg:text-page-title">{t.feedback.title}</h1>
      <p className="mt-2 max-w-[34em] text-label leading-normal text-ink-2">{t.feedback.intro}</p>

      <div className="mt-6 flex flex-col gap-6 lg:grid lg:grid-cols-2 lg:gap-x-gap-col">
        <section className="flex flex-col gap-3.5 rounded-card bg-surface p-4">
          <SectionLabel>{t.feedback.aboutYou}</SectionLabel>
          <Field label={t.feedback.email}>
            <input type="email" required autoComplete="email" value={form.email} onChange={(e) => set("email", e.target.value)} maxLength={254} disabled={sending} className={`${INPUT} mt-1 h-tap`} />
          </Field>
          <Field label={t.feedback.name} optional={t.feedback.optional}>
            <input autoComplete="name" value={form.name ?? ""} onChange={(e) => set("name", e.target.value)} maxLength={MAX_SHORT} disabled={sending} className={`${INPUT} mt-1 h-tap`} />
          </Field>
          <Field label={t.feedback.telegram} optional={t.feedback.optional}>
            <input value={form.telegram ?? ""} onChange={(e) => set("telegram", e.target.value)} maxLength={MAX_SHORT} placeholder="@handle" spellCheck={false} disabled={sending} className={`${INPUT} mt-1 h-tap`} />
          </Field>
        </section>

        <section className="flex flex-col gap-3.5 rounded-card bg-surface p-4">
          <SectionLabel>{t.feedback.yourTake}</SectionLabel>
          <Field label={t.feedback.liked} optional={t.feedback.optional}>
            <textarea rows={3} value={form.liked ?? ""} onChange={(e) => set("liked", e.target.value)} maxLength={MAX_LONG} placeholder={t.feedback.likedPlaceholder} disabled={sending} className={`${INPUT} mt-1 resize-y py-2.5`} />
          </Field>
          <Field label={t.feedback.missing} optional={t.feedback.optional}>
            <textarea rows={3} value={form.missing ?? ""} onChange={(e) => set("missing", e.target.value)} maxLength={MAX_LONG} placeholder={t.feedback.missingPlaceholder} disabled={sending} className={`${INPUT} mt-1 resize-y py-2.5`} />
          </Field>
        </section>

        <section className="flex flex-col gap-4 rounded-card bg-surface p-4 lg:col-span-2">
          <div>
            <span className="text-meta text-ink-3">{t.feedback.wouldAct}</span>
            <div role="group" aria-label={t.feedback.wouldAct} className="mt-2 flex flex-wrap gap-2">
              {WOULD_ACT.map((o: WouldAct) => (
                <Chip key={o} on={form.wouldAct === o} disabled={sending} onClick={() => set("wouldAct", form.wouldAct === o ? undefined : o)}>
                  {t.feedback.wouldActOptions[o]}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <span className="text-meta text-ink-3">
              {t.feedback.trust}
              <span className="ml-1.5 text-ink-4">{t.feedback.pickAny}</span>
            </span>
            <div role="group" aria-label={t.feedback.trust} className="mt-2 flex flex-wrap gap-2">
              {TRUST.map((o) => (
                <Chip key={o} on={form.trust.includes(o)} disabled={sending} onClick={() => toggleTrust(o)}>
                  {t.feedback.trustOptions[o]}
                </Chip>
              ))}
            </div>
          </div>
          <Field label={t.feedback.anythingElse} optional={t.feedback.optional}>
            <textarea rows={3} value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} maxLength={MAX_LONG} placeholder={t.feedback.anythingElsePlaceholder} disabled={sending} className={`${INPUT} mt-1 resize-y py-2.5`} />
          </Field>
        </section>
      </div>

      <div className="mt-6">
        <button type="submit" disabled={sending} className={`${BTN_PRIMARY} h-[52px] w-full`}>
          {sending && <Spinner />}
          {sending ? t.feedback.sending : t.feedback.submit}
        </button>
        {error ? (
          <p role="alert" className="mt-2.5 text-center text-meta text-risk">{error}</p>
        ) : (
          <p className="mt-2.5 text-center text-meta text-ink-3">{t.feedback.privacy}</p>
        )}
        <button type="button" onClick={onBack} className="mx-auto mt-3 flex h-tap items-center text-label text-ink-2 underline underline-offset-2 hover:text-ink">
          {t.feedback.backToVerdict}
        </button>
      </div>
    </form>
  );
}
