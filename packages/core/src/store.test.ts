import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { allocateObservations, timeSlice } from './store';

function withTimes(times: readonly number[]) {
  const obs = allocateObservations(times.length);
  obs.t.set(times);
  return obs;
}

describe('allocateObservations', () => {
  test('allocates every column at the requested length, zeroed', () => {
    const obs = allocateObservations(3);
    for (const column of [
      obs.stationIdx,
      obs.t,
      obs.bikesMech,
      obs.bikesElec,
      obs.docks,
      obs.status,
    ]) {
      expect(column).toHaveLength(3);
      expect(Array.from(column)).toEqual([0, 0, 0]);
    }
  });
});

describe('timeSlice', () => {
  test('empty store gives an empty slice', () => {
    expect(timeSlice(allocateObservations(0), 0, 100)).toEqual({ start: 0, end: 0 });
  });

  test('is half-open: includes t0, excludes t1', () => {
    const obs = withTimes([0, 0, 5, 5, 10, 10]);
    expect(timeSlice(obs, 5, 10)).toEqual({ start: 2, end: 4 });
  });

  test('range outside the data is empty and clamped to the ends', () => {
    const obs = withTimes([10, 20]);
    expect(timeSlice(obs, 0, 5)).toEqual({ start: 0, end: 0 });
    expect(timeSlice(obs, 30, 40)).toEqual({ start: 2, end: 2 });
  });

  test('an inverted or empty range is empty', () => {
    const obs = withTimes([0, 5, 10]);
    expect(timeSlice(obs, 10, 5)).toEqual({ start: 2, end: 2 });
    expect(timeSlice(obs, 5, 5)).toEqual({ start: 1, end: 1 });
  });

  test('property: the slice is exactly the rows with t0 <= t < t1', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 100 }), { maxLength: 100 }),
        fc.integer({ min: -10, max: 110 }),
        fc.integer({ min: -10, max: 110 }),
        (values, t0, t1) => {
          const obs = withTimes(values.sort((a, b) => a - b));
          const { start, end } = timeSlice(obs, t0, t1);
          const inside = Array.from(obs.t).filter((t) => t >= t0 && t < t1);
          expect(Array.from(obs.t.subarray(start, end))).toEqual(inside);
        },
      ),
    );
  });
});
