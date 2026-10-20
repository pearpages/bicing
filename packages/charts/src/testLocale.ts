import caES from 'd3-time-format/locale/ca-ES';
import enGB from 'd3-time-format/locale/en-GB';
import type { TimeLocaleDefinition } from 'd3-time-format';
import type { ChartLocale } from './locale';

/**
 * Test-only locales. The real ones are built by the app from its dictionaries; these mirror their
 * shape so chart tests don't depend on apps/web (P10). Not exported from index.ts.
 */
export function testLocale(tag: 'ca' | 'en'): ChartLocale {
  const number = new Intl.NumberFormat(tag === 'ca' ? 'ca-ES' : 'en-GB');
  const formatNumber = (value: number) => number.format(value);
  // The JSON types are inferred as plain string arrays; d3 wants its fixed-length tuples.
  return tag === 'ca'
    ? {
        time: caES as TimeLocaleDefinition,
        formatNumber,
        label: 'Bicicletes disponibles per estació al llarg del temps',
        station: (n) => `Estació ${String(n)}`,
        bikes: (n) => `${String(n)} bicicletes`,
        capped: (renderer, max, requested) =>
          `${renderer}: com a màxim ${max} punts (se n'han demanat ${requested})`,
      }
    : {
        time: enGB as TimeLocaleDefinition,
        formatNumber,
        label: 'Bikes available per station over time',
        station: (n) => `Station ${String(n)}`,
        bikes: (n) => `${String(n)} bikes`,
        capped: (renderer, max, requested) =>
          `${renderer} is capped at ${max} points (${requested} requested)`,
      };
}
