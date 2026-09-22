import { describe, expect, test } from 'vitest';
import { buildStationSeries } from './station-series';
import { allocateObservations } from './store';
import { Status, type StationTable } from './types';

function stationsWithCapacity(capacity: number[]): StationTable {
  return {
    length: capacity.length,
    ids: capacity.map(String),
    names: capacity.map(String),
    lat: new Float32Array(capacity.length),
    lon: new Float32Array(capacity.length),
    capacity: Uint8Array.from(capacity),
  };
}

/** Rows as [t, station, mech, elec, status]. */
function store(rows: [number, number, number, number, number][]) {
  const obs = allocateObservations(rows.length);
  rows.forEach(([t, s, mech, elec, status], i) => {
    obs.t[i] = t;
    obs.stationIdx[i] = s;
    obs.bikesMech[i] = mech;
    obs.bikesElec[i] = elec;
    obs.status[i] = status;
  });
  return obs;
}

describe('buildStationSeries', () => {
  test('empty store: every station empty, mean fill 0', () => {
    const r = buildStationSeries(allocateObservations(0), stationsWithCapacity([10, 20]));
    expect(Array.from(r.offsets)).toEqual([0, 0, 0]);
    expect(Array.from(r.meanFill)).toEqual([0, 0]);
  });

  test('groups by station in time order and sums mechanical + electric bikes', () => {
    const r = buildStationSeries(
      store([
        [0, 0, 1, 1, Status.InService],
        [0, 1, 5, 0, Status.InService],
        [5, 0, 3, 1, Status.InService],
        [5, 1, 2, 2, Status.InService],
      ]),
      stationsWithCapacity([10, 10]),
    );
    expect(Array.from(r.offsets)).toEqual([0, 2, 4]);
    expect(Array.from(r.x)).toEqual([0, 5, 0, 5]);
    expect(Array.from(r.y)).toEqual([2, 4, 5, 4]);
    expect(r.meanFill[0]).toBeCloseTo(0.3);
    expect(r.meanFill[1]).toBeCloseTo(0.45);
  });

  test('leaves out closed rows, so the closure becomes a gap rather than a zero', () => {
    const r = buildStationSeries(
      store([
        [0, 0, 4, 0, Status.InService],
        [5, 0, 0, 0, Status.Closed],
        [10, 0, 4, 0, Status.InService],
      ]),
      stationsWithCapacity([8]),
    );
    expect(Array.from(r.x)).toEqual([0, 10]);
    expect(Array.from(r.y)).toEqual([4, 4]);
    expect(r.meanFill[0]).toBeCloseTo(0.5);
  });

  test('precomputes gap-free lines per station, and the extents', () => {
    const r = buildStationSeries(
      store([
        [0, 0, 1, 0, Status.InService],
        [0, 1, 7, 0, Status.InService],
        [5, 0, 2, 0, Status.InService],
        [100, 0, 3, 0, Status.InService],
        [100, 1, 9, 0, Status.InService],
      ]),
      stationsWithCapacity([10, 10]),
      15,
    );
    // Station 0: [0, 5] | gap | [100]. Station 1: [0] | gap | [100].
    expect(Array.from(r.lineStarts)).toEqual([0, 2, 3, 4, 5]);
    expect(Array.from(r.lineStation)).toEqual([0, 0, 1, 1]);
    expect([r.xMin, r.xMax, r.yMax, r.maxGap]).toEqual([0, 100, 9, 15]);
  });

  test('empty series have zero extents and no lines', () => {
    const r = buildStationSeries(allocateObservations(0), stationsWithCapacity([10]));
    expect(Array.from(r.lineStarts)).toEqual([0]);
    expect([r.xMin, r.xMax, r.yMax]).toEqual([0, 0, 0]);
  });

  test('a zero-capacity station does not divide by zero', () => {
    const r = buildStationSeries(
      store([[0, 0, 0, 0, Status.InService]]),
      stationsWithCapacity([0]),
    );
    expect(r.meanFill[0]).toBe(0);
  });
});
