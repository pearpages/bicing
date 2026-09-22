import { Status, type ObservationColumns, type StationTable } from './types';

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
}

/**
 * Only in-service rows are kept. A closed station has *no* reading rather than a reading of zero
 * bikes, so closures become gaps in the line instead of fake drops to zero (P9).
 * Two passes, a count and then a stable fill: O(n) with no sort, relying on the store's
 * (t, stationIdx) order.
 */
export function buildStationSeries(obs: ObservationColumns, stations: StationTable): StationSeries {
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
  for (let s = 0; s < stationCount; s++) {
    const count = (offsets[s + 1] as number) - (offsets[s] as number);
    meanFill[s] = count === 0 ? 0 : Math.min(1, (fillSum[s] as number) / count);
  }
  return { x, y, offsets, meanFill };
}
