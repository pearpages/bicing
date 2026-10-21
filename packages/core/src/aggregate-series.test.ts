import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { allocateAggregates, buildAggregateSeries } from './aggregate-series';
import type { StationTable } from './types';

const HOUR = 60;

function stations(capacity: number[]): StationTable {
  return {
    length: capacity.length,
    ids: capacity.map(String),
    names: capacity.map(String),
    lat: new Float32Array(capacity.length),
    lon: new Float32Array(capacity.length),
    capacity: Uint8Array.from(capacity),
  };
}

/** Buckets as [t, station, min, max, mean, count], in (t, station) order. */
function buckets(rows: [number, number, number, number, number, number][]) {
  const agg = allocateAggregates(rows.length);
  rows.forEach(([t, s, min, max, mean, count], i) => {
    agg.t[i] = t;
    agg.stationIdx[i] = s;
    agg.min[i] = min;
    agg.max[i] = max;
    agg.mean[i] = mean;
    agg.count[i] = count;
  });
  return agg;
}

describe('buildAggregateSeries', () => {
  test('empty: every station empty, no lines', () => {
    const r = buildAggregateSeries(allocateAggregates(0), stations([10, 20]), HOUR);
    expect(Array.from(r.offsets)).toEqual([0, 0, 0]);
    expect(Array.from(r.lineStarts)).toEqual([0]);
    expect(r.yMax).toBe(0);
  });

  test('a bucket becomes min then max at its centre, grouped by station', () => {
    const r = buildAggregateSeries(
      buckets([
        [0, 1, 2, 9, 5, 12],
        [0, 0, 3, 4, 3.5, 12],
        [60, 0, 1, 6, 4, 10],
      ]),
      stations([10, 20]),
      HOUR,
    );
    expect(Array.from(r.offsets)).toEqual([0, 4, 6]);
    expect(Array.from(r.x)).toEqual([30, 30, 90, 90, 30, 30]);
    expect(Array.from(r.y)).toEqual([3, 4, 1, 6, 2, 9]);
    expect(r.maxGap).toBe(HOUR);
    expect([r.xMin, r.xMax, r.yMax]).toEqual([30, 90, 9]);
  });

  test('a missing bucket breaks the line; adjacent buckets do not', () => {
    const r = buildAggregateSeries(
      buckets([
        [0, 0, 1, 2, 1.5, 12],
        [60, 0, 1, 2, 1.5, 12],
        [180, 0, 1, 2, 1.5, 12],
      ]),
      stations([10]),
      HOUR,
    );
    expect(Array.from(r.lineStarts)).toEqual([0, 4, 6]);
    expect(Array.from(r.lineStation)).toEqual([0, 0]);
  });

  test('mean fill is weighted by the readings behind each bucket', () => {
    const r = buildAggregateSeries(
      buckets([
        [0, 0, 0, 10, 10, 3],
        [60, 0, 0, 10, 0, 1],
      ]),
      stations([10]),
      HOUR,
    );
    // (1.0 × 3 + 0.0 × 1) / 4 readings.
    expect(r.meanFill[0]).toBeCloseTo(0.75, 6);
  });

  test('properties: two points per bucket, extremes kept, lines break only at missing buckets', () => {
    const bucketRows = fc.uniqueArray(
      fc.record({
        bucket: fc.integer({ min: 0, max: 40 }),
        station: fc.integer({ min: 0, max: 2 }),
        a: fc.integer({ min: 0, max: 60 }),
        b: fc.integer({ min: 0, max: 60 }),
      }),
      { selector: (r) => `${String(r.bucket)}:${String(r.station)}`, maxLength: 80 },
    );
    fc.assert(
      fc.property(bucketRows, (raw) => {
        const sorted = [...raw].sort((p, q) => p.bucket - q.bucket || p.station - q.station);
        const agg = buckets(
          sorted.map((r) => {
            const min = Math.min(r.a, r.b);
            const max = Math.max(r.a, r.b);
            return [r.bucket * HOUR, r.station, min, max, (min + max) / 2, 1];
          }),
        );
        const series = buildAggregateSeries(agg, stations([60, 60, 60]), HOUR);
        expect(series.x.length).toBe(2 * sorted.length);
        expect(series.yMax).toBe(Math.max(0, ...sorted.map((r) => Math.max(r.a, r.b))));
        for (let s = 0; s < 3; s++) {
          const mine = sorted.filter((r) => r.station === s).map((r) => r.bucket);
          const breaks = mine.slice(1).filter((b, i) => b - (mine[i] as number) > 1).length;
          const lines = Array.from(series.lineStation).filter((owner) => owner === s).length;
          expect(lines).toBe(mine.length === 0 ? 0 : breaks + 1);
        }
      }),
    );
  });
});
