import { toEpochMs } from '@bicing/core';
import { utcDay, utcMonday, utcMonth, utcYear } from 'd3-time';
import { timeFormatLocale, type TimeLocaleDefinition } from 'd3-time-format';

/**
 * Everything language-specific the chart shows. The app builds it from its dictionary and swaps it
 * with `setLocale()`; the chart keeps no copy of its own (ADR 0011).
 */
export interface ChartLocale {
  /** A d3-time-format definition, e.g. `d3-time-format/locale/ca-ES`. */
  readonly time: TimeLocaleDefinition;
  readonly formatNumber: (value: number) => string;
  /** The chart's accessible name. */
  readonly label: string;
  /** Default tooltip lines, used when the app gives no `describe`. Station numbers are 1-based. */
  readonly station: (number: number) => string;
  readonly bikes: (count: number) => string;
  /** First line of a gap's tooltip (T2.6). */
  readonly noData: string;
  /** A gap's length, e.g. "12 dies" / "3 h 20 min". */
  readonly duration: (minutes: number) => string;
  /** Why a renderer drew nothing. The counts arrive already formatted with `formatNumber`. */
  readonly capped: (renderer: string, max: string, requested: string) => string;
}

/** Formatters derived from a ChartLocale, built once per locale rather than per frame. */
export interface ChartFormat {
  /** A sample time (minutes since the epoch) for tooltips. */
  readonly time: (t: number) => string;
  /** An x-axis tick: the coarsest unit the tick lands on decides how much it says. */
  readonly tick: (date: Date) => string;
  readonly number: (value: number) => string;
}

export function chartFormat(locale: ChartLocale): ChartFormat {
  const names = timeFormatLocale(locale.time);
  const tooltip = names.utcFormat('%a %-d %b %Y, %H:%M UTC');
  const clock = names.utcFormat('%H:%M');
  const day = names.utcFormat('%a %-d');
  const week = names.utcFormat('%-d %b');
  const month = names.utcFormat('%B');
  const year = names.utcFormat('%Y');
  return {
    time: (t) => tooltip(new Date(toEpochMs(t))),
    // d3's own multi-scale format, minus seconds (the narrowest zoom is minutes) and with a 24-hour
    // clock and Monday weeks, as both supported locales expect.
    tick: (date) => {
      if (utcDay(date) < date) return clock(date);
      if (utcMonth(date) < date) return utcMonday(date) < date ? day(date) : week(date);
      if (utcYear(date) < date) return month(date);
      return year(date);
    },
    number: locale.formatNumber,
  };
}
