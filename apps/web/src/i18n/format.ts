/** Number formats for one locale. Built once per language switch, not per call (P27). */
export interface NumberFormats {
  readonly int: (value: number) => string;
  /** A fixed number of decimals, as in a results table. */
  readonly fixed: (value: number, digits?: number) => string;
  readonly ms: (value: number) => string;
  /** Milliseconds below a second, seconds above. */
  readonly duration: (ms: number) => string;
  /** `YYYY-MM` as a month name, e.g. "setembre del 2026" / "September 2026". */
  readonly month: (month: string) => string;
}

export function numberFormats(tag: string): NumberFormats {
  const byDigits = new Map<number, Intl.NumberFormat>();
  const fixed = (value: number, digits = 1) => {
    let format = byDigits.get(digits);
    if (!format) {
      format = new Intl.NumberFormat(tag, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
      byDigits.set(digits, format);
    }
    return format.format(value);
  };
  const int = (value: number) => fixed(value, 0);
  const monthName = new Intl.DateTimeFormat(tag, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return {
    int,
    fixed,
    ms: (value) => `${fixed(value)} ms`,
    duration: (ms) => (ms < 1_000 ? `${int(ms)} ms` : `${fixed(ms / 1_000)} s`),
    month: (month) => monthName.format(new Date(`${month}-01T00:00:00Z`)),
  };
}
