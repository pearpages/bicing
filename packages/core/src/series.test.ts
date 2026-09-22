import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { buildSeriesIndex, gather, segmentStarts } from './series';

/** Random store rows sorted by (t, stationIdx), each (t, station) pair at most once. */
const sortedRows = fc
  .tuple(fc.integer({ min: 1, max: 6 }), fc.integer({ min: 0, max: 30 }))
  .chain(([stations, steps]) =>
    fc
      .array(fc.boolean(), { minLength: stations * steps, maxLength: stations * steps })
      .map((present) => {
        const t: number[] = [];
        const station: number[] = [];
        present.forEach((keep, k) => {
          if (!keep) return;
          t.push(Math.floor(k / stations) * 5);
          station.push(k % stations);
        });
        return { stations, t: Uint32Array.from(t), station: Uint16Array.from(station) };
      }),
  );

describe('buildSeriesIndex', () => {
  test('empty input: all series empty', () => {
    const { order, offsets } = buildSeriesIndex(new Uint16Array(0), 3);
    expect(order).toHaveLength(0);
    expect(Array.from(offsets)).toEqual([0, 0, 0, 0]);
  });

  test('groups rows by station and keeps time order', () => {
    // t:        0  0  5  5  10
    // station:  0  1  0  1  1
    const { order, offsets } = buildSeriesIndex(Uint16Array.of(0, 1, 0, 1, 1), 2);
    expect(Array.from(offsets)).toEqual([0, 2, 5]);
    expect(Array.from(order)).toEqual([0, 2, 1, 3, 4]);
  });

  test('rejects station indices outside the table', () => {
    expect(() => buildSeriesIndex(Uint16Array.of(0, 2), 2)).toThrow(RangeError);
  });

  test('property: each series has only its rows, in ascending t', () => {
    fc.assert(
      fc.property(sortedRows, ({ stations, t, station }) => {
        const { order, offsets } = buildSeriesIndex(station, stations);
        expect(offsets[stations]).toBe(t.length);
        expect(new Set(order).size).toBe(order.length);
        for (let s = 0; s < stations; s++) {
          const rows = Array.from(order.subarray(offsets[s], offsets[s + 1]));
          expect(rows.every((r) => station[r] === s)).toBe(true);
          const times = rows.map((r) => t[r] ?? -1);
          expect(times).toEqual([...times].sort((a, b) => a - b));
        }
      }),
    );
  });
});

describe('gather', () => {
  test('keeps the array type and follows the order', () => {
    const out = gather(Uint8Array.of(10, 20, 30), Uint32Array.of(2, 0, 1));
    expect(out).toBeInstanceOf(Uint8Array);
    expect(Array.from(out)).toEqual([30, 10, 20]);
  });
});

describe('segmentStarts', () => {
  test('empty range has no segments', () => {
    expect(segmentStarts(Uint32Array.of(1, 2), 1, 1, 5)).toHaveLength(0);
  });

  test('a single point is one segment', () => {
    expect(Array.from(segmentStarts(Uint32Array.of(7), 0, 1, 5))).toEqual([0]);
  });

  test('splits only where the step exceeds maxGap (a step equal to maxGap stays joined)', () => {
    const x = Uint32Array.of(0, 5, 10, 30, 35, 100);
    expect(Array.from(segmentStarts(x, 0, x.length, 5))).toEqual([0, 3, 5]);
  });

  test('works within a sub-range', () => {
    const x = Uint32Array.of(0, 5, 100, 105, 500);
    expect(Array.from(segmentStarts(x, 1, 4, 5))).toEqual([1, 2]);
  });
});
