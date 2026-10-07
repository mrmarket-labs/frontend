"use client";

import { LOCALES, dict } from "@/lib/i18n";
import { useLocale } from "@/lib/i18n/context";

/** Two quiet chips, each language named in itself. The current one reads as selected. */
export function LanguageSwitch({ className = "" }: { className?: string }) {
  const { locale, setLocale, t } = useLocale();
  return (
    <div role="group" aria-label={t.common.language} className={`flex items-center gap-0.5 rounded-pill bg-surface-control p-0.5 ${className}`}>
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          lang={dict(l).htmlLang}
          aria-pressed={l === locale}
          onClick={() => setLocale(l)}
          className={`flex h-7 min-w-[38px] items-center justify-center rounded-pill px-2.5 text-meta transition-colors ${l === locale ? "bg-surface-raised text-ink" : "text-ink-3 hover:text-ink-2"}`}
        >
          {dict(l).name}
        </button>
      ))}
    </div>
  );
}
