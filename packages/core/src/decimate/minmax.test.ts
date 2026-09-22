import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { minMaxPerPixel } from './minmax';
import { isStrictlyIncreasingWithin, seriesArbitrary, sourceGaps } from './testing';

const MAX_GAP = 40;

describe('minMaxPerPixel', () => {
  test('empty input and degenerate views return nothing', () => {
    const x = Uint32Array.of(1, 2, 3);
    const y = Uint8Array.of(1, 2, 3);
    expect(minMaxPerPixel(x, y, 0, 0, 0, 10, 100).indices).toHaveLength(0);
    expect(minMaxPerPixel(x, y, 0, 3, 0, 10, 0).indices).toHaveLength(0);
    expect(minMaxPerPixel(x, y, 0, 3, 10, 10, 100).indices).toHaveLength(0);
  });

  test('a single point is kept, as one segment', () => {
    const r = minMaxPerPixel(Uint32Array.of(5), Uint8Array.of(9), 0, 1, 0, 10, 10);
    expect(Array.from(r.indices)).toEqual([0]);
    expect(Array.from(r.segmentStarts)).toEqual([0]);
  });

  test('fewer points than pixels (one per column) is the identity', () => {
    const x = Uint32Array.of(0, 1, 2, 3, 4);
    const y = Uint8Array.of(3, 1, 4, 1, 5);
    expect(Array.from(minMaxPerPixel(x, y, 0, 5, 0, 5, 5).indices)).toEqual([0, 1, 2, 3, 4]);
  });

  test('one column keeps first, min, max, last in source order', () => {
    //            0  1  2  3  4  5
    const y = Uint8Array.of(5, 9, 2, 7, 1, 6);
    const x = Uint32Array.of(0, 1, 2, 3, 4, 5);
    // All six points fall in pixel 0; the min is at 4 and the max at 1.
    expect(Array.from(minMaxPerPixel(x, y, 0, 6, 0, 100, 1).indices)).toEqual([0, 1, 4, 5]);
  });

  test('all-equal values collapse to first and last per column', () => {
    const x = Uint32Array.of(0, 1, 2, 3);
    const y = Uint8Array.of(4, 4, 4, 4);
    expect(Array.from(minMaxPerPixel(x, y, 0, 4, 0, 100, 1).indices)).toEqual([0, 3]);
  });

  test('a gap inside one pixel column still splits the line', () => {
    const x = Uint32Array.of(0, 1, 100, 101);
    const y = Uint8Array.of(1, 2, 3, 4);
    const r = minMaxPerPixel(x, y, 0, 4, 0, 1_000, 1, 10);
    expect(Array.from(r.indices)).toEqual([0, 1, 2, 3]);
    expect(Array.from(r.segmentStarts)).toEqual([0, 2]);
  });

  test('points outside [x0, x1] get their own buckets instead of merging into edge columns', () => {
    const x = Uint32Array.of(0, 10, 11, 20);
    const y = Uint8Array.of(9, 1, 2, 9);
    // View [10, 20) over 1 pixel: the point at x=0 is bucket -1, not bucket 0.
    expect(Array.from(minMaxPerPixel(x, y, 0, 4, 10, 20, 1).indices)).toEqual([0, 1, 2, 3]);
  });

  test('property: indices are sorted, in range, and keep both endpoints', () => {
    fc.assert(
      fc.property(seriesArbitrary, fc.integer({ min: 1, max: 60 }), ({ x, y }, pixels) => {
        const n = x.length;
        const r = minMaxPerPixel(x, y, 0, n, x[0] ?? 0, (x[n - 1] ?? 0) + 1, pixels, MAX_GAP);
        expect(isStrictlyIncreasingWithin(r.indices, 0, n)).toBe(true);
        if (n > 0) {
          expect(r.indices[0]).toBe(0);
          expect(r.indices[r.indices.length - 1]).toBe(n - 1);
        }
      }),
    );
  });

  test('property: every run (pixel column without gaps) keeps its exact min, max, first and last', () => {
    fc.assert(
      fc.property(seriesArbitrary, fc.integer({ min: 1, max: 60 }), ({ x, y }, pixels) => {
        const n = x.length;
        if (n === 0) return;
        const x0 = x[0] ?? 0;
        const x1 = (x[n - 1] ?? 0) + 1;
        const r = minMaxPerPixel(x, y, 0, n, x0, x1, pixels, MAX_GAP);
        const kept = new Set(r.indices);
        const bucketOf = (i: number) => Math.floor(((x[i] ?? 0) - x0) * (pixels / (x1 - x0)));

        let runStart = 0;
        for (let i = 1; i <= n; i++) {
          const closes =
            i === n || bucketOf(i) !== bucketOf(i - 1) || (x[i] ?? 0) - (x[i - 1] ?? 0) > MAX_GAP;
          if (!closes) continue;
          const run = Array.from({ length: i - runStart }, (_, k) => runStart + k);
          const keptInRun = run.filter((k) => kept.has(k));
          const ys = (idx: number[]) => idx.map((k) => y[k] ?? 0);
          expect(keptInRun).toContain(runStart);
          expect(keptInRun).toContain(i - 1);
          expect(Math.min(...ys(keptInRun))).toBe(Math.min(...ys(run)));
          expect(Math.max(...ys(keptInRun))).toBe(Math.max(...ys(run)));
          expect(keptInRun.length).toBeLessThanOrEqual(4);
          runStart = i;
        }
      }),
    );
  });

  test('property: segments start exactly at the source gaps (never bridged)', () => {
    fc.assert(
      fc.property(seriesArbitrary, fc.integer({ min: 1, max: 60 }), ({ x, y }, pixels) => {
        const n = x.length;
        if (n === 0) return;
        const r = minMaxPerPixel(x, y, 0, n, x[0] ?? 0, (x[n - 1] ?? 0) + 1, pixels, MAX_GAP);
        const startsAsSourceRows = Array.from(r.segmentStarts, (p) => r.indices[p]);
        expect(startsAsSourceRows).toEqual([0, ...sourceGaps(x, 0, n, MAX_GAP)]);
      }),
    );
  });

  test('property: works on a sub-range without touching rows outside it', () => {
    fc.assert(
      fc.property(seriesArbitrary, fc.nat(), fc.nat(), ({ x, y }, a, b) => {
        const n = x.length;
        const start = n === 0 ? 0 : a % n;
        const end = n === 0 ? 0 : start + (b % (n - start + 1));
        const r = minMaxPerPixel(x, y, start, end, x[start] ?? 0, (x[n - 1] ?? 0) + 1, 20, MAX_GAP);
        expect(isStrictlyIncreasingWithin(r.indices, start, end)).toBe(true);
        expect(r.indices.length > 0).toBe(end > start);
      }),
    );
  });
});
