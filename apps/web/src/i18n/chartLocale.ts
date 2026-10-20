import type { ChartLocale } from '@bicing/charts';
import caES from 'd3-time-format/locale/ca-ES';
import enGB from 'd3-time-format/locale/en-GB';
import type { TimeLocaleDefinition } from 'd3-time-format';
import { FORMAT_TAGS, type Locale } from './locales';
import type { Messages } from './messages.ca';

// The JSON types are inferred as plain string arrays; d3 wants its fixed-length tuples.
const TIME_LOCALES: Record<Locale, TimeLocaleDefinition> = {
  ca: caES as TimeLocaleDefinition,
  en: enGB as TimeLocaleDefinition,
};

/** What the chart needs from the active language (ADR 0011: the chart never sees the dictionaries). */
export function chartLocale(locale: Locale, messages: Messages): ChartLocale {
  const number = new Intl.NumberFormat(FORMAT_TAGS[locale]);
  return {
    time: TIME_LOCALES[locale],
    formatNumber: (value) => number.format(value),
    ...messages.chart,
  };
}
