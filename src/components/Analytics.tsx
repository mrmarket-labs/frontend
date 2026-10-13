"use client";

import { GoogleAnalytics } from "@next/third-parties/google";
import { useEffect, useState } from "react";
import { loadConsent, onConsentOpen, saveConsent, type Consent } from "@/lib/analytics";
import { useLocale } from "@/lib/i18n/context";
import { BTN_PRIMARY, BTN_TONAL } from "./ui";

/**
 * Google Analytics, behind consent. Nothing loads until the visitor accepts; the banner asks once
 * and comes back from the footer's "Cookie settings". It sits above the mobile tab bar.
 */
export function Analytics({ gaId }: { gaId: string }) {
  const { t } = useLocale();
  const [consent, setConsent] = useState<Consent | null>(null);
  const [asking, setAsking] = useState(false);

  // Stored consent is only readable in the browser, so the first render shows neither tag nor banner.
  useEffect(() => {
    const saved = loadConsent();
    /* eslint-disable react-hooks/set-state-in-effect */
    setConsent(saved);
    setAsking(saved === null);
    /* eslint-enable react-hooks/set-state-in-effect */
    return onConsentOpen(() => setAsking(true));
  }, []);

  function answer(next: Consent) {
    saveConsent(next);
    setConsent(next);
    setAsking(false);
  }

  return (
    <>
      {consent === "granted" && <GoogleAnalytics gaId={gaId} />}
      {asking && (
        <div
          role="dialog"
          aria-label={t.consent.title}
          className="fixed inset-x-4 bottom-[calc(84px+env(safe-area-inset-bottom))] z-40 mx-auto max-w-[440px] rounded-card bg-surface-raised p-4 shadow-lg lg:bottom-6"
        >
          <p className="text-body font-medium text-ink">{t.consent.title}</p>
          <p className="mt-1 text-meta leading-relaxed text-ink-3">{t.consent.body}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => answer("denied")} className={`${BTN_TONAL} h-10 bg-surface-control`}>
              {t.consent.decline}
            </button>
            <button type="button" onClick={() => answer("granted")} className={`${BTN_PRIMARY} h-10`}>
              {t.consent.accept}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
