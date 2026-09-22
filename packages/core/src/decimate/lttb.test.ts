import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { lttb } from './lttb';
import { isStrictlyIncreasingWithin, seriesArbitrary, sourceGaps } from './testing';

const MAX_GAP = 40;

function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

describe('lttb', () => {
  test('empty input or zero budget returns nothing', () => {
    expect(lttb(new Uint32Array(0), new Uint8Array(0), 0, 0, 10).indices).toHaveLength(0);
    expect(lttb(Uint32Array.of(1, 2), Uint8Array.of(1, 2), 0, 2, 0).indices).toHaveLength(0);
  });

  test('a single point is kept', () => {
    expect(Array.from(lttb(Uint32Array.of(3), Uint8Array.of(7), 0, 1, 5).indices)).toEqual([0]);
  });

  test('fewer points than the threshold is the identity', () => {
    const x = Uint32Array.from(range(8));
    const y = Uint8Array.of(1, 5, 2, 8, 3, 9, 4, 7);
    expect(Array.from(lttb(x, y, 0, 8, 8).indices)).toEqual(range(8));
    expect(Array.from(lttb(x, y, 0, 8, 100).indices)).toEqual(range(8));
  });

  test('picks the spike: the largest triangle', () => {
    const x = Uint32Array.from(range(7));
    const y = Uint8Array.of(0, 0, 0, 10, 0, 0, 0);
    expect(Array.from(lttb(x, y, 0, 7, 3).indices)).toEqual([0, 3, 6]);
  });

  test('all-equal values still return exactly `threshold` points', () => {
    const x = Uint32Array.from(range(100));
    const y = new Uint8Array(100).fill(4);
    const r = lttb(x, y, 0, 100, 10);
    expect(r.indices).toHaveLength(10);
    expect(r.indices[0]).toBe(0);
    expect(r.indices[9]).toBe(99);
  });

  test('a gap splits the budget and keeps both sides of the gap', () => {
    const x = Uint32Array.of(0, 1, 2, 3, 4, 500, 501, 502, 503, 504);
    const y = Uint8Array.of(0, 9, 0, 9, 0, 0, 9, 0, 9, 0);
    const r = lttb(x, y, 0, 10, 6, 10);
    expect(Array.from(r.segmentStarts)).toEqual([0, 3]);
    expect(Array.from(r.indices.subarray(0, 3))).toContain(4);
    expect(r.indices[3]).toBe(5);
  });

  const arbitrary = fc.tuple(seriesArbitrary, fc.integer({ min: 1, max: 80 }));

  test('property: sorted, in range, endpoints kept, and within max(threshold, 2 × segments)', () => {
    fc.assert(
      fc.property(arbitrary, ([{ x, y }, threshold]) => {
        const n = x.length;
        const r = lttb(x, y, 0, n, threshold, MAX_GAP);
        expect(isStrictlyIncreasingWithin(r.indices, 0, n)).toBe(true);
        if (n === 0) return;
        expect(r.indices[0]).toBe(0);
        expect(r.indices[r.indices.length - 1]).toBe(n - 1);
        const segments = 1 + sourceGaps(x, 0, n, MAX_GAP).length;
        expect(r.indices.length).toBeLessThanOrEqual(Math.max(threshold, 2 * segments));
      }),
    );
  });

  test('property: without gaps, output is exactly min(n, threshold) points (threshold >= 2)', () => {
    fc.assert(
      fc.property(arbitrary, ([{ x, y }, threshold]) => {
        const n = x.length;
        const t = Math.max(2, threshold);
        expect(lttb(x, y, 0, n, t).indices).toHaveLength(Math.min(n, t));
      }),
    );
  });

  test('property: n <= threshold is the identity', () => {
    fc.assert(
      fc.property(seriesArbitrary, ({ x, y }) => {
        const n = x.length;
        expect(Array.from(lttb(x, y, 0, n, n, MAX_GAP).indices)).toEqual(range(n));
      }),
    );
  });

  test('property: segments start exactly at source gaps, and both sides of every gap are kept', () => {
    fc.assert(
      fc.property(arbitrary, ([{ x, y }, threshold]) => {
        const n = x.length;
        if (n === 0) return;
        const r = lttb(x, y, 0, n, threshold, MAX_GAP);
        const gaps = sourceGaps(x, 0, n, MAX_GAP);
        expect(Array.from(r.segmentStarts, (p) => r.indices[p])).toEqual([0, ...gaps]);
        const kept = new Set(r.indices);
        for (const g of gaps) expect(kept.has(g - 1)).toBe(true);
      }),
    );
  });
});
