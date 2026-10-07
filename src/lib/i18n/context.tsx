"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { DEFAULT_LOCALE, LOCALE_COOKIE, dict, type Dict, type Locale } from "./index";

interface LocaleContext {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Dict;
}

const Ctx = createContext<LocaleContext>({ locale: DEFAULT_LOCALE, setLocale: () => undefined, t: dict(DEFAULT_LOCALE) });

/**
 * The language the page renders in. The server picks `initial` from the cookie (or the browser's
 * Accept-Language), so the first paint is already in the right language; switching writes the
 * cookie back so the next request and every API call agree.
 */
export function LocaleProvider({ initial, children }: { initial: Locale; children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initial);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = dict(next).htmlLang;
  }, []);

  const value = useMemo(() => ({ locale, setLocale, t: dict(locale) }), [locale, setLocale]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useLocale = () => useContext(Ctx);
export const useT = () => useContext(Ctx).t;
