export const LOCALES = ['ca', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'ca';

/** The region-qualified tags for `Intl` and d3-time-format, which ship `ca-ES` and `en-GB`. */
export const FORMAT_TAGS: Record<Locale, string> = { ca: 'ca-ES', en: 'en-GB' };

/** Each language is named in itself, so a visitor finds theirs whatever language is active. */
export const LANGUAGE_NAMES: Record<Locale, string> = { ca: 'Català', en: 'English' };

export function isLocale(value: string | null): value is Locale {
  return value !== null && (LOCALES as readonly string[]).includes(value);
}

/**
 * `?lang=` wins so an English link can be shared, then the visitor's remembered choice, then
 * Catalan. The browser language is ignored on purpose: the site is Catalan-first (ADR 0011).
 * Both inputs are untrusted, so anything outside the allowlist falls through.
 */
export function resolveLocale(search: string, stored: string | null): Locale {
  const requested = new URLSearchParams(search).get('lang')?.trim().toLowerCase() ?? null;
  if (isLocale(requested)) return requested;
  if (isLocale(stored)) return stored;
  return DEFAULT_LOCALE;
}
