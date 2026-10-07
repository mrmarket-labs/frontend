import { en, type Dict } from "./en";
import { zh } from "./zh";

export type { Dict } from "./en";

export const LOCALES = ["en", "zh"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/** Set by the language switch; read by the server layout and every API route. */
export const LOCALE_COOKIE = "diversify:locale";

const DICTS: Record<Locale, Dict> = { en, zh };

export const isLocale = (v: unknown): v is Locale => typeof v === "string" && (LOCALES as readonly string[]).includes(v);

export const dict = (locale: Locale): Dict => DICTS[locale];

/** First supported language in an Accept-Language header, or null. */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const tag = part.split(";")[0].trim().toLowerCase();
    if (tag.startsWith("zh")) return "zh";
    if (tag.startsWith("en")) return "en";
  }
  return null;
}

/** Locale cookie from a raw Cookie header (API routes get a plain `Request`). */
export function localeFromCookieHeader(header: string | null | undefined): Locale | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name !== LOCALE_COOKIE) continue;
    const value = decodeURIComponent(rest.join("="));
    if (isLocale(value)) return value;
  }
  return null;
}

/** What an API route should answer in: the cookie the switch set, else the browser's language. */
export function localeFromRequest(request: Request): Locale {
  return localeFromCookieHeader(request.headers.get("cookie")) ?? localeFromAcceptLanguage(request.headers.get("accept-language")) ?? DEFAULT_LOCALE;
}

/** Translates a coded wallet-layer error; anything else is shown as it came. */
export function errorMessage(e: unknown, t: Dict): string {
  if (e instanceof AppError) return t.errors[e.code](e.vars);
  return e instanceof Error ? e.message : String(e);
}

export type ErrorCode = keyof Dict["errors"];

/**
 * An error the UI can render in the user's language. The message is the English text, so logs
 * and any uncaught path stay readable.
 */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly vars: Record<string, string> = {},
  ) {
    super(en.errors[code](vars));
    this.name = "AppError";
  }
}
