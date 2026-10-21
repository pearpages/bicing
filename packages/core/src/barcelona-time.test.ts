import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { barcelonaHours, barcelonaOffset } from './barcelona-time';
import { toMinutes } from './time';

const hourIn = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Madrid',
  hour: 'numeric',
  hourCycle: 'h23',
});
const intlHour = (t: number) => Number(hourIn.format(new Date(Date.UTC(2018, 0, 1) + t * 60_000)));
const at = (iso: string) => toMinutes(Date.parse(iso));

describe('Barcelona time', () => {
  test('switches at 01:00 UTC on the last Sundays of March and October', () => {
    // 2026: summer time from 29 March to 25 October.
    expect(barcelonaOffset(at('2026-03-29T00:59Z'))).toBe(60);
    expect(barcelonaOffset(at('2026-03-29T01:00Z'))).toBe(120);
    expect(barcelonaOffset(at('2026-10-25T00:59Z'))).toBe(120);
    expect(barcelonaOffset(at('2026-10-25T01:00Z'))).toBe(60);
  });

  test('the morning rush is local: 07:30 in summer is 05:30 UTC', () => {
    expect(Array.from(barcelonaHours([at('2026-07-01T05:30Z'), at('2026-01-15T06:30Z')]))).toEqual([
      7, 7,
    ]);
  });

  test('property: agrees with Intl for Europe/Madrid, in order or not', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: at('2018-01-01T00:00Z'), max: at('2030-12-31T23:59Z') }), {
          maxLength: 60,
        }),
        (times) => {
          const expected = times.map(intlHour);
          expect(Array.from(barcelonaHours(times))).toEqual(expected);
          const sorted = [...times].sort((a, b) => a - b);
          expect(Array.from(barcelonaHours(sorted))).toEqual(sorted.map(intlHour));
        },
      ),
    );
  });
});
