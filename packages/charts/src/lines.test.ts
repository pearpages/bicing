import { allocateObservations, buildStationSeries, Status, type StationSeries } from '@bicing/core';
import { describe, expect, test } from 'vitest';
import { decimatedLines, fullLines, visiblePointCount } from './lines';

/** Builds series from [station, t, bikes] rows (sorted by t, then station), with capacity 10. */
function seriesOf(rows: [number, number, number][], stations: number): StationSeries {
  const obs = allocateObservations(rows.length);
  rows.forEach(([s, t, bikes], i) => {
    obs.stationIdx[i] = s;
    obs.t[i] = t;
    obs.bikesMech[i] = bikes;
    obs.status[i] = Status.InService;
  });
  const table = {
    length: stations,
    ids: [],
    names: [],
    lat: new Float32Array(stations),
    lon: new Float32Array(stations),
    capacity: new Uint8Array(stations).fill(10),
  };
  return buildStationSeries(obs, table, 15);
}

/** Two stations: 0 has a gap between t=10 and t=100; 1 is continuous. */
const series = seriesOf(
  [
    [0, 0, 1],
    [1, 0, 9],
    [0, 5, 2],
    [1, 5, 8],
    [0, 10, 3],
    [1, 10, 7],
    [1, 15, 6],
    [0, 100, 4],
    [0, 105, 5],
  ],
  2,
);

describe('fullLines', () => {
  test('splits stations at gaps, with no copy of x/y', () => {
    const lines = fullLines(series);
    expect(Array.from(lines.lineStarts)).toEqual([0, 3, 5, 9]);
    expect(Array.from(lines.lineValue)).toEqual([0.3, 0.3, 0.75].map(Math.fround));
    expect(lines.x).toBe(series.x);
  });

  test('an empty series has no lines', () => {
    expect(Array.from(fullLines(seriesOf([], 1)).lineStarts)).toEqual([0]);
  });
});

describe('visiblePointCount', () => {
  test('counts visible points plus one neighbor per side, per station', () => {
    expect(visiblePointCount(series, 0, 1_000)).toBe(9);
    // Station 0: 5, 10 inside [4, 12] plus neighbors 0 and 100 → 4. Station 1: 5, 10 plus 0 and 15 → 4.
    expect(visiblePointCount(series, 4, 12)).toBe(8);
  });
});

describe('decimatedLines', () => {
  test('with enough pixels, keeps every visible point and the same line breaks', () => {
    const lines = decimatedLines(series, 'minmax', 0, 106, 1_000);
    expect(Array.from(lines.x)).toEqual(Array.from(series.x));
    expect(Array.from(lines.lineStarts)).toEqual([0, 3, 5, 9]);
  });

  test('packs gathered values and keeps the color value of each line', () => {
    const lines = decimatedLines(series, 'lttb', 0, 106, 2);
    expect(Array.from(lines.lineValue)).toEqual([0.3, 0.3, 0.75].map(Math.fround));
    expect(lines.lineStarts[lines.lineStarts.length - 1]).toBe(lines.x.length);
    // Each station keeps at least its endpoints per segment.
    expect(Array.from(lines.x)).toEqual(expect.arrayContaining([0, 10, 100, 105, 15]));
  });

  test('stations with nothing visible contribute no lines', () => {
    const lines = decimatedLines(series, 'minmax', 200, 300, 100);
    // Only station 0's last point (105) is a left neighbor of the view.
    expect(lines.lineValue.length).toBeLessThanOrEqual(2);
  });
});
