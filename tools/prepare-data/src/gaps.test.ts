import { toMinutes } from '@bicing/core';
import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { findGaps, gapReport, missingDays, monthsBetween, monthStart } from './gaps';

const T = 15;

describe('findGaps', () => {
  test('finds silences longer than the threshold, including against the coverage edges', () => {
    expect(findGaps([10, 20, 30, 60, 70], 0, 100, T)).toEqual([
      { t0: 30, t1: 60 },
      { t0: 70, t1: 100 },
    ]);
    // Exactly the threshold isn't a gap, like a line that doesn't break at exactly maxGap.
    expect(findGaps([0, 15, 30], 0, 45, T)).toEqual([]);
  });

  test('no snapshots means the whole coverage is a gap; a single one splits it', () => {
    expect(findGaps([], 0, 100, T)).toEqual([{ t0: 0, t1: 100 }]);
    expect(findGaps([50], 0, 100, T)).toEqual([
      { t0: 0, t1: 50 },
      { t0: 50, t1: 100 },
    ]);
  });

  test('properties: gaps are longer than the threshold, hold no snapshot, and miss no silence', () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.integer({ min: 0, max: 999 }), { maxLength: 60 }), (raw) => {
        const snapshots = [...raw].sort((a, b) => a - b);
        const gaps = findGaps(snapshots, 0, 1_000, T);
        for (const gap of gaps) {
          expect(gap.t1 - gap.t0).toBeGreaterThan(T);
          expect(snapshots.some((t) => t > gap.t0 && t < gap.t1)).toBe(false);
        }
        const edges = [0, ...snapshots, 1_000];
        const silences = edges.slice(1).filter((t, i) => t - (edges[i] as number) > T).length;
        expect(gaps).toHaveLength(silences);
      }),
    );
  });
});

describe('days and months', () => {
  const day = (iso: string) => toMinutes(Date.parse(iso));

  test('missingDays lists the UTC days with no snapshot', () => {
    const snapshots = [day('2026-09-01T10:00Z'), day('2026-09-03T23:59Z')];
    expect(missingDays(snapshots, day('2026-09-01T00:00Z'), day('2026-09-05T00:00Z'))).toEqual([
      '2026-09-02',
      '2026-09-04',
    ]);
  });

  test('monthsBetween spans years; monthStart handles December', () => {
    expect(monthsBetween('2025-11', '2026-02')).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
    expect(monthStart('2025-12', 1)).toBe(day('2026-01-01T00:00Z'));
  });

  test('gapReport finds a missing month, a late start and an early end', () => {
    // Data from 28 Oct to 29 Dec, every 5 minutes except November, whose archive is missing.
    const snapshots: number[] = [];
    for (let t = day('2025-10-28T17:50Z'); t < day('2025-12-29T20:10Z'); t += 5)
      if (t < day('2025-10-31T23:00Z') || t >= day('2025-11-30T23:00Z')) snapshots.push(t);
    const report = gapReport(snapshots, ['2025-10', '2025-12'], T);
    expect(report.missingMonths).toEqual(['2025-11']);
    expect(report.gaps.map((g) => [g.from, g.to])).toEqual([
      ['2025-10-01T00:00:00.000Z', '2025-10-28T17:50:00.000Z'],
      ['2025-10-31T22:55:00.000Z', '2025-11-30T23:00:00.000Z'],
      ['2025-12-29T20:05:00.000Z', '2026-01-01T00:00:00.000Z'],
    ]);
    expect(report.missingDays).toContain('2025-11-15');
    expect(report.missingDays).toContain('2025-12-31');
    expect(report.missingDays).not.toContain('2025-11-30');
    expect(report.coverage).toMatchObject({
      from: '2025-10-01T00:00:00.000Z',
      to: '2026-01-01T00:00:00.000Z',
    });
  });
});
