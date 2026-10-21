import { segmentStarts } from './series';
import type { StationSeries } from './station-series';
import type { StationTable } from './types';

/**
 * Per-station buckets (ADR 0014): `min`/`max`/`mean` bikes over the in-service readings of one hour
 * or day, and how many readings that was. Sorted by (t, stationIdx), like observations.
 */
export interface AggregateColumns {
  readonly length: number;
  readonly stationIdx: Uint16Array;
  /** Bucket start, minutes since the epoch. */
  readonly t: Uint32Array;
  readonly min: Uint8Array;
  readonly max: Uint8Array;
  readonly mean: Float32Array;
  readonly count: Uint16Array;
}

export function allocateAggregates(length: number): AggregateColumns {
  return {
    length,
    stationIdx: new Uint16Array(length),
    t: new Uint32Array(length),
    min: new Uint8Array(length),
    max: new Uint8Array(length),
    mean: new Float32Array(length),
    count: new Uint16Array(length),
  };
}

/**
 * Each bucket becomes two points at its centre, its min and then its max: the vertical stroke
 * min/max decimation draws, so peaks survive (P9, ADR 0006). Consecutive buckets are one bucket
 * apart, so the gap threshold is one bucket: a missing bucket breaks the line.
 * Same two passes as `buildStationSeries`: count per station, then a stable fill.
 */
export function buildAggregateSeries(
  agg: AggregateColumns,
  stations: StationTable,
  bucketMinutes: number,
): StationSeries {
  const n = agg.length;
  const stationCount = stations.length;
  const offsets = new Uint32Array(stationCount + 1);
  for (let i = 0; i < n; i++) {
    const s = agg.stationIdx[i] as number;
    offsets[s + 1] = (offsets[s + 1] as number) + 2;
  }
  for (let s = 0; s < stationCount; s++)
    offsets[s + 1] = (offsets[s + 1] as number) + (offsets[s] as number);

  const total = offsets[stationCount] as number;
  const x = new Uint32Array(total);
  const y = new Uint8Array(total);
  // Mean fill weighted by readings, so a thin bucket counts for what it holds.
  const fillSum = new Float64Array(stationCount);
  const readings = new Float64Array(stationCount);
  const cursor = offsets.slice(0, stationCount);
  const centre = Math.floor(bucketMinutes / 2);
  for (let i = 0; i < n; i++) {
    const s = agg.stationIdx[i] as number;
    const at = cursor[s] as number;
    const t = (agg.t[i] as number) + centre;
    x[at] = t;
    y[at] = agg.min[i] as number;
    x[at + 1] = t;
    y[at + 1] = agg.max[i] as number;
    cursor[s] = at + 2;
    const capacity = stations.capacity[s] as number;
    const count = agg.count[i] as number;
    if (capacity > 0) {
      fillSum[s] = (fillSum[s] as number) + ((agg.mean[i] as number) / capacity) * count;
      readings[s] = (readings[s] as number) + count;
    }
  }

  const meanFill = new Float32Array(stationCount);
  const starts: number[] = [];
  const owners: number[] = [];
  let xMin = Number.POSITIVE_INFINITY;
  let xMax = Number.NEGATIVE_INFINITY;
  for (let s = 0; s < stationCount; s++) {
    const lo = offsets[s] as number;
    const hi = offsets[s + 1] as number;
    const weight = readings[s] as number;
    meanFill[s] = weight === 0 ? 0 : Math.min(1, (fillSum[s] as number) / weight);
    if (hi === lo) continue;
    xMin = Math.min(xMin, x[lo] as number);
    xMax = Math.max(xMax, x[hi - 1] as number);
    for (const start of segmentStarts(x, lo, hi, bucketMinutes)) {
      starts.push(start);
      owners.push(s);
    }
  }
  starts.push(total);

  let yMax = 0;
  for (const value of y) if (value > yMax) yMax = value;

  return {
    x,
    y,
    offsets,
    meanFill,
    lineStarts: Uint32Array.from(starts),
    lineStation: Uint16Array.from(owners),
    maxGap: bucketMinutes,
    xMin: total === 0 ? 0 : xMin,
    xMax: total === 0 ? 0 : xMax,
    yMax,
  };
}
