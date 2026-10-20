import { describe, expect, test } from 'vitest';
import { chartFormat } from './locale';
import { testLocale } from './testLocale';

const ca = chartFormat(testLocale('ca'));
const en = chartFormat(testLocale('en'));

/** Minutes since the data epoch (2018-01-01T00:00Z), the unit samples are stored in. */
function minutes(iso: string): number {
  return (Date.parse(iso) - Date.UTC(2018, 0, 1)) / 60_000;
}

describe('chartFormat', () => {
  test('tooltip times use the locale names and a 24-hour clock', () => {
    const t = minutes('2026-09-22T14:05:00Z');
    expect(ca.time(t)).toBe('dt. 22 set. 2026, 14:05 UTC');
    expect(en.time(t)).toBe('Tue 22 Sep 2026, 14:05 UTC');
  });

  test('ticks say as much as the unit they land on', () => {
    const cases: readonly (readonly [string, string, string])[] = [
      ['2026-09-22T14:30:00Z', '14:30', '14:30'],
      ['2026-09-22T00:00:00Z', 'dt. 22', 'Tue 22'],
      // A Monday starts a week, so it names the month instead of the weekday.
      ['2026-09-21T00:00:00Z', '21 set.', '21 Sep'],
      ['2026-09-01T00:00:00Z', 'setembre', 'September'],
      ['2026-01-01T00:00:00Z', '2026', '2026'],
    ];
    for (const [iso, catalan, english] of cases) {
      expect(ca.tick(new Date(iso))).toBe(catalan);
      expect(en.tick(new Date(iso))).toBe(english);
    }
  });

  test('numbers come from the locale formatter', () => {
    expect(ca.number(1_000_000)).toBe('1.000.000');
    expect(en.number(1_000_000)).toBe('1,000,000');
  });
});
