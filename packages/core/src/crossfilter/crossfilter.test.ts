import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { buildBinIndex } from './bin-index';
import { Crossfilter } from './crossfilter';

describe('buildBinIndex', () => {
  test('groups rows by bin, each bin a contiguous run in row order', () => {
    const index = buildBinIndex(Uint8Array.of(2, 0, 2, 1, 0), 4);
    expect(Array.from(index.offsets)).toEqual([0, 2, 3, 5, 5]);
    expect(Array.from(index.rows)).toEqual([1, 4, 3, 0, 2]);
  });

  test('empty input, and a bin out of range fails loudly', () => {
    expect(Array.from(buildBinIndex(new Uint8Array(0), 2).offsets)).toEqual([0, 0, 0]);
    expect(() => buildBinIndex(Uint8Array.of(3), 3)).toThrow(/not below 3/);
  });
});

/** Rows: hour bin, fill bin, station. */
function crossfilter(rows: readonly (readonly [number, number, number])[]) {
  return new Crossfilter({
    dimensions: [
      { bins: Uint8Array.from(rows.map((r) => r[0])), binCount: 3 },
      { bins: Uint8Array.from(rows.map((r) => r[1])), binCount: 4 },
    ],
    group: { bins: Uint16Array.from(rows.map((r) => r[2])), binCount: 2 },
  });
}

describe('Crossfilter', () => {
  const rows = [
    [0, 0, 0],
    [1, 1, 0],
    [2, 2, 1],
    [1, 3, 1],
  ] as const;

  test('with no filters, everything counts', () => {
    const cf = crossfilter(rows);
    expect(Array.from(cf.histogram(0))).toEqual([1, 2, 1]);
    expect(Array.from(cf.histogram(1))).toEqual([1, 1, 1, 1]);
    expect(Array.from(cf.groupCounts())).toEqual([2, 2]);
    expect(cf.passing()).toBe(4);
  });

  test('a histogram counts under the other filters, not its own', () => {
    const cf = crossfilter(rows);
    cf.filterRange(0, 1, 2);
    // Hour's own histogram is unchanged: it still shows where its brush could go.
    expect(Array.from(cf.histogram(0))).toEqual([1, 2, 1]);
    // Occupancy only counts rows in hour 1.
    expect(Array.from(cf.histogram(1))).toEqual([0, 1, 0, 1]);
    expect(Array.from(cf.groupCounts())).toEqual([1, 1]);
    expect(cf.passing()).toBe(2);
  });

  test('filters combine, and clearing one restores what it hid', () => {
    const cf = crossfilter(rows);
    cf.filterRange(0, 1, 2);
    cf.filterRange(1, 3, 4);
    expect(cf.passing()).toBe(1);
    expect(Array.from(cf.groupCounts())).toEqual([0, 1]);
    cf.clear(0);
    expect(cf.passing()).toBe(1);
    expect(Array.from(cf.histogram(0))).toEqual([0, 1, 0]);
    cf.clear(1);
    expect(cf.passing()).toBe(4);
  });

  test('time keeps a row range; moving it only changes its ends', () => {
    const cf = crossfilter(rows);
    cf.filterRows(1, 3);
    expect(cf.passing()).toBe(2);
    expect(Array.from(cf.histogram(0))).toEqual([0, 1, 1]);
    cf.filterRows(2, 10);
    expect(cf.passing()).toBe(2);
    expect(Array.from(cf.groupCounts())).toEqual([0, 2]);
    cf.filterRows(0, 4);
    expect(cf.passing()).toBe(4);
  });

  test('edge cases: empty input, one row, all rows in one bin', () => {
    const empty = crossfilter([]);
    empty.filterRange(0, 1, 2);
    empty.filterRows(0, 0);
    expect(empty.passing()).toBe(0);

    const one = crossfilter([[1, 1, 1]]);
    one.filterRange(1, 0, 1);
    expect(one.passing()).toBe(0);
    expect(Array.from(one.histogram(0))).toEqual([0, 0, 0]);

    const same = crossfilter([
      [2, 2, 0],
      [2, 2, 0],
      [2, 2, 0],
    ]);
    same.filterRange(0, 2, 3);
    expect(same.passing()).toBe(3);
    same.filterRange(0, 0, 2);
    expect(same.passing()).toBe(0);
    expect(Array.from(same.histogram(1))).toEqual([0, 0, 0, 0]);
  });

  test('property: every count matches a brute-force filter after any sequence of operations', () => {
    const row = fc.tuple(
      fc.integer({ min: 0, max: 2 }),
      fc.integer({ min: 0, max: 3 }),
      fc.integer({ min: 0, max: 1 }),
    );
    const op = fc.oneof(
      fc.record({
        kind: fc.constant('range' as const),
        d: fc.integer({ min: 0, max: 1 }),
        lo: fc.integer({ min: 0, max: 4 }),
        hi: fc.integer({ min: 0, max: 4 }),
      }),
      fc.record({
        kind: fc.constant('bins' as const),
        d: fc.integer({ min: 0, max: 1 }),
        keep: fc.array(fc.boolean(), { minLength: 4, maxLength: 4 }),
      }),
      fc.record({
        kind: fc.constant('rows' as const),
        r0: fc.integer({ min: -2, max: 60 }),
        r1: fc.integer({ min: -2, max: 60 }),
      }),
      fc.record({ kind: fc.constant('clear' as const), d: fc.integer({ min: 0, max: 1 }) }),
    );
    fc.assert(
      fc.property(
        fc.array(row, { maxLength: 50 }),
        fc.array(op, { maxLength: 20 }),
        (rows, ops) => {
          const cf = crossfilter(rows);
          // The filter state, kept the slow way.
          const keep = [
            [true, true, true, true],
            [true, true, true, true],
          ];
          let range: [number, number] = [0, rows.length];
          for (const o of ops) {
            if (o.kind === 'range') {
              cf.filterRange(o.d, o.lo, o.hi);
              keep[o.d] = [0, 1, 2, 3].map((b) => b >= o.lo && b < o.hi);
            } else if (o.kind === 'bins') {
              cf.filterBins(o.d, (b) => o.keep[b] ?? false);
              keep[o.d] = [0, 1, 2, 3].map((b) => o.keep[b] ?? false);
            } else if (o.kind === 'rows') {
              cf.filterRows(o.r0, o.r1);
              const lo = Math.max(0, Math.min(o.r0, rows.length));
              range = [lo, Math.max(lo, Math.min(o.r1, rows.length))];
            } else {
              cf.clear(o.d);
              keep[o.d] = [true, true, true, true];
            }
            const passes = (i: number, except: number) =>
              i >= range[0] &&
              i < range[1] &&
              [0, 1].every((d) => d === except || (keep[d]?.[rows[i]?.[d] ?? 0] ?? false));
            for (const d of [0, 1]) {
              const brute = new Array<number>(d === 0 ? 3 : 4).fill(0);
              rows.forEach((r, i) => {
                const bin = d === 0 ? r[0] : r[1];
                if (passes(i, d)) brute[bin] = (brute[bin] ?? 0) + 1;
              });
              expect(Array.from(cf.histogram(d))).toEqual(brute);
            }
            const groups = [0, 0];
            rows.forEach((r, i) => {
              if (passes(i, -1)) groups[r[2]] = (groups[r[2]] ?? 0) + 1;
            });
            expect(Array.from(cf.groupCounts())).toEqual(groups);
            expect(cf.passing()).toBe(groups.reduce((sum, n) => sum + n, 0));
          }
        },
      ),
    );
  });
});
