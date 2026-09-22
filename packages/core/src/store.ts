import { lowerBound } from './search';
import type { ObservationColumns, RowRange } from './types';

/** Allocates zeroed columns for `length` rows. Callers fill them in (t, stationIdx) order. */
export function allocateObservations(length: number): ObservationColumns {
  return {
    length,
    stationIdx: new Uint16Array(length),
    t: new Uint32Array(length),
    bikesMech: new Uint8Array(length),
    bikesElec: new Uint8Array(length),
    docks: new Uint8Array(length),
    status: new Uint8Array(length),
  };
}

/**
 * Rows with t in [t0, t1), found in O(log n) because rows are sorted by t. Every other view
 * works on this slice instead of scanning the whole dataset (P6).
 */
export function timeSlice(obs: ObservationColumns, t0: number, t1: number): RowRange {
  const start = lowerBound(obs.t, t0);
  const end = t1 <= t0 ? start : lowerBound(obs.t, t1, start);
  return { start, end };
}
