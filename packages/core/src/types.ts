import type { TimeMinutes } from './time';

// A const object rather than an enum: erasable syntax, and the values are what gets stored in the Uint8Array.
export const Status = {
  InService: 0,
  Closed: 1,
  Other: 2,
} as const;
export type Status = (typeof Status)[keyof typeof Status];

/**
 * Station status history, one typed array per column (P4). Rows are sorted by (t, stationIdx),
 * so any time range is one contiguous slice.
 */
export interface ObservationColumns {
  readonly length: number;
  readonly stationIdx: Uint16Array;
  readonly t: Uint32Array;
  readonly bikesMech: Uint8Array;
  readonly bikesElec: Uint8Array;
  readonly docks: Uint8Array;
  readonly status: Uint8Array;
}

export type ObservationColumnName = Exclude<keyof ObservationColumns, 'length'>;

/** About 500 rows, loaded once. Row i is the station with dense index i. */
export interface StationTable {
  readonly length: number;
  readonly ids: readonly string[];
  readonly names: readonly string[];
  readonly lat: Float32Array;
  readonly lon: Float32Array;
  readonly capacity: Uint8Array;
}

/** Half-open row range [start, end). */
export interface RowRange {
  readonly start: number;
  readonly end: number;
}

export interface TimeRange {
  readonly t0: TimeMinutes;
  readonly t1: TimeMinutes;
}
