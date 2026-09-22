import { MINUTES_PER_DAY, Status } from '@bicing/core';
import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { CADENCE_MINUTES, generate, stationCountFor } from './generate';

describe('generate', () => {
  test('produces exactly the requested number of rows in every column', () => {
    const { observations: o } = generate({ seed: 1, rows: 12_345 });
    expect(o.length).toBe(12_345);
    for (const column of [o.stationIdx, o.t, o.bikesMech, o.bikesElec, o.docks, o.status]) {
      expect(column).toHaveLength(12_345);
    }
  });

  test('zero rows is a valid, empty dataset', () => {
    const { observations, stations } = generate({ seed: 1, rows: 0 });
    expect(observations.length).toBe(0);
    expect(stations.length).toBe(1);
  });

  test('the same seed gives byte-identical output; another seed differs', () => {
    const a = generate({ seed: 42, rows: 50_000 }).observations;
    const b = generate({ seed: 42, rows: 50_000 }).observations;
    const c = generate({ seed: 43, rows: 50_000 }).observations;
    expect(a).toEqual(b);
    expect(c.bikesMech).not.toEqual(a.bikesMech);
  });

  test('bikes + docks never exceed capacity; closed stations report nothing', () => {
    const { observations: o, stations } = generate({ seed: 7, rows: 200_000 });
    let closed = 0;
    for (let i = 0; i < o.length; i++) {
      const cap = stations.capacity[o.stationIdx[i] ?? 0] ?? 0;
      const total = (o.bikesMech[i] ?? 0) + (o.bikesElec[i] ?? 0) + (o.docks[i] ?? 0);
      if (o.status[i] === Status.Closed) {
        closed++;
        expect(total).toBe(0);
      } else {
        expect(total).toBe(cap);
      }
    }
    expect(closed).toBeGreaterThan(0);
  });

  test('samples every 5 minutes and skips requested gap days entirely', () => {
    const stations = 2;
    const perDay = (MINUTES_PER_DAY / CADENCE_MINUTES) * stations;
    const { observations: o } = generate({ seed: 3, rows: perDay * 3, stations, gapDays: [1] });
    const days = new Set(Array.from(o.t, (t) => Math.floor((t - (o.t[0] ?? 0)) / MINUTES_PER_DAY)));
    expect([...days].sort()).toEqual([0, 2, 3]);
    expect((o.t[2] ?? 0) - (o.t[0] ?? 0)).toBe(CADENCE_MINUTES);
  });

  test('small tiers use fewer stations, so they still cover a full day', () => {
    expect(stationCountFor(10_000)).toBe(34);
    expect(stationCountFor(1_000_000)).toBe(500);
    expect(stationCountFor(10)).toBe(1);
  });

  test('property: rows are sorted by (t, stationIdx) with no duplicates', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 ** 31 }),
        fc.integer({ min: 0, max: 3_000 }),
        fc.integer({ min: 1, max: 20 }),
        (seed, rows, stations) => {
          const { observations: o } = generate({ seed, rows, stations, gapDays: [0] });
          for (let i = 1; i < o.length; i++) {
            const dt = (o.t[i] ?? 0) - (o.t[i - 1] ?? 0);
            const ds = (o.stationIdx[i] ?? 0) - (o.stationIdx[i - 1] ?? 0);
            expect(dt > 0 || (dt === 0 && ds > 0)).toBe(true);
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});
