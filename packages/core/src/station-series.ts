import { segmentStarts } from './series';
import { Status, type ObservationColumns, type StationTable } from './types';

/**
 * Samples arrive every 5 minutes. A missing sample or two is jitter; more than 15 minutes without a
 * reading is a gap that lines must not bridge (P9).
 */
export const DEFAULT_MAX_GAP_MINUTES = 15;

/**
 * Per-station series laid out contiguously: station s is [offsets[s], offsets[s + 1]) in x and y.
 * Built once per dataset, so every frame after that streams through memory in order.
 */
export interface StationSeries {
  /** Minutes since the epoch, ascending within each station. */
  readonly x: Uint32Array;
  /** Bikes available (mechanical + electric). */
  readonly y: Uint8Array;
  readonly offsets: Uint32Array;
  /** Mean of y / capacity per station, in [0, 1]. Used as the line's color value. */
  readonly meanFill: Float32Array;
  /** Gap-free runs ("lines") across all stations: line k is [lineStarts[k], lineStarts[k + 1]). */
  readonly lineStarts: Uint32Array;
  /** Station of each line. */
  readonly lineStation: Uint16Array;
  /** The gap threshold used for lineStarts. Decimation must use the same one. */
  readonly maxGap: number;
  /** Extents, precomputed so consumers never scan the data on the main thread (P8). 0 when empty. */
  readonly xMin: number;
  readonly xMax: number;
  readonly yMax: number;
}

/**
 * Only in-service rows are kept. A closed station has *no* reading rather than a reading of zero
 * bikes, so closures become gaps in the line instead of fake drops to zero (P9).
 * Two passes, a count and then a stable fill: O(n) with no sort, relying on the store's
 * (t, stationIdx) order.
 */
export function buildStationSeries(
  obs: ObservationColumns,
  stations: StationTable,
  maxGap = DEFAULT_MAX_GAP_MINUTES,
): StationSeries {
  const n = obs.length;
  const stationCount = stations.length;
  const offsets = new Uint32Array(stationCount + 1);
  for (let i = 0; i < n; i++) {
    if (obs.status[i] !== Status.InService) continue;
    const s = obs.stationIdx[i] as number;
    offsets[s + 1] = (offsets[s + 1] as number) + 1;
  }
  for (let s = 0; s < stationCount; s++) {
    offsets[s + 1] = (offsets[s + 1] as number) + (offsets[s] as number);
  }

  const total = offsets[stationCount] as number;
  const x = new Uint32Array(total);
  const y = new Uint8Array(total);
  const fillSum = new Float64Array(stationCount);
  const cursor = offsets.slice(0, stationCount);
  for (let i = 0; i < n; i++) {
    if (obs.status[i] !== Status.InService) continue;
    const s = obs.stationIdx[i] as number;
    const at = cursor[s] as number;
    const bikes = Math.min(255, (obs.bikesMech[i] as number) + (obs.bikesElec[i] as number));
    x[at] = obs.t[i] as number;
    y[at] = bikes;
    cursor[s] = at + 1;
    const capacity = stations.capacity[s] as number;
    if (capacity > 0) fillSum[s] = (fillSum[s] as number) + bikes / capacity;
  }

  const meanFill = new Float32Array(stationCount);
  const starts: number[] = [];
  const owners: number[] = [];
  let xMin = Number.POSITIVE_INFINITY;
  let xMax = Number.NEGATIVE_INFINITY;
  for (let s = 0; s < stationCount; s++) {
    const lo = offsets[s] as number;
    const hi = offsets[s + 1] as number;
    meanFill[s] = hi === lo ? 0 : Math.min(1, (fillSum[s] as number) / (hi - lo));
    if (hi === lo) continue;
    xMin = Math.min(xMin, x[lo] as number);
    xMax = Math.max(xMax, x[hi - 1] as number);
    for (const start of segmentStarts(x, lo, hi, maxGap)) {
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
    maxGap,
    xMin: total === 0 ? 0 : xMin,
    xMax: total === 0 ? 0 : xMax,
    yMax,
  };
}
