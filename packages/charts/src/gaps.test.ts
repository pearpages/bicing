// @vitest-environment jsdom
import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { chartFormat } from './locale';
import { drawGaps, gapAt, gapLines, sortGaps } from './gaps';
import { testLocale } from './testLocale';

describe('gapAt', () => {
  const gaps = sortGaps([
    { t0: 100, t1: 200 },
    { t0: 10, t1: 20 },
    { t0: 50, t1: 50 },
  ]);

  test('finds the gap whose interior holds t; the edges are real snapshots', () => {
    expect(gapAt(gaps, 15)).toEqual({ t0: 10, t1: 20 });
    expect(gapAt(gaps, 150)).toEqual({ t0: 100, t1: 200 });
    for (const t of [5, 10, 20, 50, 99, 100, 200, 300])
      expect(gapAt(gaps, t), String(t)).toBeNull();
  });

  test('property: agrees with a linear scan over disjoint gaps', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: 500 }), { minLength: 0, maxLength: 40 }),
        fc.integer({ min: -10, max: 1_100 }),
        (edges, t) => {
          // Pairs of sorted unique edges are disjoint gaps.
          const sorted = [...edges].sort((a, b) => a - b).map((e) => e * 2);
          const list = [];
          for (let i = 0; i + 1 < sorted.length; i += 2)
            list.push({ t0: sorted[i] as number, t1: sorted[i + 1] as number });
          const expected = list.find((g) => g.t0 < t && t < g.t1) ?? null;
          expect(gapAt(sortGaps(list), t)).toEqual(expected);
        },
      ),
    );
  });
});

describe('drawGaps', () => {
  test('draws the gaps that overlap the domain, clipped to it, at least 1 px wide', () => {
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const gaps = sortGaps([
      { t0: 0, t1: 50 },
      { t0: 500, t1: 500.5 },
      { t0: 2_000, t1: 3_000 },
    ]);
    drawGaps(group, gaps, [10, 1_010], 1_000, 200);
    const rects = [...group.querySelectorAll('rect.bp-chart__gap')].map((r) => [
      Number(r.getAttribute('x')),
      Number(r.getAttribute('width')),
      Number(r.getAttribute('height')),
    ]);
    expect(rects).toEqual([
      [0, 40, 200],
      [490, 1, 200],
    ]);
  });
});

describe('gapLines', () => {
  test('says there is no data, from when to when, how long, and why', () => {
    const lines = gapLines(
      { t0: 0, t1: 3 * 1_440, note: 'Mes no publicat' },
      chartFormat(testLocale('ca')),
      testLocale('ca'),
    );
    expect(lines).toEqual([
      'Sense dades',
      'dl. 1 gen. 2018, 00:00 UTC →',
      'dj. 4 gen. 2018, 00:00 UTC',
      '3 dies',
      'Mes no publicat',
    ]);
  });
});
