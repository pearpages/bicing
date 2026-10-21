import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { fillAt } from './fill-at';
import type { StationSeries } from './station-series';

/** Per-station readings as [t, bikes][], in station order, with a 15-minute gap threshold. */
function series(stations: (readonly (readonly [number, number])[])[], maxGap = 15): StationSeries {
  const offsets = new Uint32Array(stations.length + 1);
  stations.forEach((rows, s) => (offsets[s + 1] = (offsets[s] as number) + rows.length));
  const rows = stations.flat();
  return {
    x: Uint32Array.from(rows.map(([t]) => t)),
    y: Uint8Array.from(rows.map(([, bikes]) => bikes)),
    offsets,
    meanFill: new Float32Array(stations.length),
    lineStarts: Uint32Array.of(0),
    lineStation: new Uint16Array(0),
    maxGap,
    xMin: 0,
    xMax: 0,
    yMax: 0,
  };
}

describe('fillAt', () => {
  const s = series([
    [
      [0, 5],
      [5, 10],
      [10, 20],
    ],
    [[100, 4]],
    [],
  ]);

  test('takes each station’s last reading at or before t, over its capacity', () => {
    expect(Array.from(fillAt(s, [20, 8, 10], 7))).toEqual([0.5, Number.NaN, Number.NaN]);
    expect(Array.from(fillAt(s, [20, 8, 10], 10))).toEqual([1, Number.NaN, Number.NaN]);
    expect(Array.from(fillAt(s, [20, 8, 10], 110))).toEqual([Number.NaN, 0.5, Number.NaN]);
  });

  test('no data before the first reading, after a silence longer than maxGap, or without capacity', () => {
    const at = (t: number, capacity = [20, 8, 10]) => Array.from(fillAt(s, capacity, t));
    expect(at(-1)[0]).toBeNaN();
    expect(at(25)[0]).toBe(1);
    expect(at(26)[0]).toBeNaN();
    expect(at(7, [0, 8, 10])[0]).toBeNaN();
  });

  test('caps at full when a station reports more bikes than its capacity', () => {
    expect(fillAt(series([[[0, 30]]]), [20], 0)[0]).toBe(1);
  });

  test('property: the value comes from the latest reading within maxGap, or is NaN', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: 200 }), { maxLength: 30 }),
        fc.integer({ min: -10, max: 230 }),
        (raw, t) => {
          const times = [...raw].sort((a, b) => a - b);
          const readings = times.map((time) => [time, time % 21] as const);
          const value = fillAt(series([readings]), [20], t)[0];
          const before = readings.filter(([time]) => time <= t).at(-1);
          if (!before || t - before[0] > 15) expect(value).toBeNaN();
          else expect(value).toBeCloseTo(Math.min(1, before[1] / 20), 6);
        },
      ),
    );
  });
});
