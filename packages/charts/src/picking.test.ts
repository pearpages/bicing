import { allocateObservations, buildStationSeries, Status, type StationSeries } from '@bicing/core';
import { describe, expect, test } from 'vitest';
import { pickAt } from './picking';

/** [station, t, bikes] rows in store order; capacity 40; maxGap 15. */
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
    capacity: new Uint8Array(stations).fill(40),
  };
  return buildStationSeries(obs, table, 15);
}

// Station 0 sits at 10 bikes, station 1 at 30. Station 1 has no readings between t=10 and t=100.
const series = seriesOf(
  [
    [0, 0, 10],
    [1, 0, 30],
    [0, 5, 10],
    [1, 5, 30],
    [0, 10, 10],
    [1, 10, 30],
    [0, 50, 12],
    [0, 100, 10],
    [1, 100, 30],
  ],
  2,
);

describe('pickAt', () => {
  test('picks the station whose value is closest to the pointer at that time', () => {
    expect(pickAt(series, 5, 28, 100)).toMatchObject({ station: 1, t: 5, y: 30 });
    expect(pickAt(series, 5, 12, 100)).toMatchObject({ station: 0, t: 5, y: 10 });
  });

  test('snaps to the nearest sample in time', () => {
    expect(pickAt(series, 6, 12, 100)?.t).toBe(5);
    expect(pickAt(series, 8, 12, 100)?.t).toBe(10);
  });

  test('never picks inside a gap: station 1 has no reading near t=50', () => {
    // Station 1 would be closer in y, but it has no data there.
    expect(pickAt(series, 50, 30, 100)).toMatchObject({ station: 0, y: 12 });
  });

  test('nothing near the pointer in y, or no data at all at that time, returns null', () => {
    expect(pickAt(series, 5, 20, 3)).toBeNull();
    expect(pickAt(series, 75, 10, 100)).toBeNull();
  });

  test('empty series pick nothing', () => {
    expect(pickAt(seriesOf([], 3), 0, 0, 100)).toBeNull();
  });

  test('ties go to the lower station index', () => {
    const tie = seriesOf(
      [
        [0, 0, 10],
        [1, 0, 20],
      ],
      2,
    );
    expect(pickAt(tie, 0, 15, 100)?.station).toBe(0);
  });
});
