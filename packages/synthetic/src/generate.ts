import {
  allocateObservations,
  MINUTES_PER_DAY,
  Status,
  toMinutes,
  type ObservationColumns,
  type StationTable,
  type TimeMinutes,
} from '@bicing/core';
import { gaussian, mulberry32 } from './prng';
import { generateStations } from './stations';

export const CADENCE_MINUTES = 5;
const STEPS_PER_DAY = MINUTES_PER_DAY / CADENCE_MINUTES;
const MAX_STATIONS = 500;
// Commute hours are in Barcelona local time. CET (UTC+1) is close enough: DST would only shift the curve by an hour.
const LOCAL_OFFSET_MINUTES = 60;

export interface GenerateOptions {
  readonly seed: number;
  /** Exact number of observation rows to produce. */
  readonly rows: number;
  /** Defaults to 500. Smaller datasets use fewer stations, so they still cover at least one full day. */
  readonly stations?: number;
  /** First timestamp. Defaults to 2024-01-01 (a Monday). */
  readonly start?: TimeMinutes;
  /** Day offsets (0 = first day) with no data at all, like the outages in the real history. */
  readonly gapDays?: readonly number[];
}

export interface SyntheticDataset {
  readonly stations: StationTable;
  readonly observations: ObservationColumns;
}

/** Stations used for a given size: up to 500, but never so many that the data spans less than a day. */
export function stationCountFor(rows: number): number {
  return Math.max(1, Math.min(MAX_STATIONS, Math.floor(rows / STEPS_PER_DAY)));
}

function logistic(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Commute shape in [0, 1]: rises between 7 and 10, holds through the working day, and falls
 * between 17 and 20.
 */
function commuteShape(hour: number): number {
  return logistic((hour - 8.5) * 2) - logistic((hour - 18) * 1.5);
}

/**
 * Generates `rows` observations in store order (t, then stationIdx), deterministically from `seed`.
 * Plain loops over preallocated typed arrays: generating 50M rows must not allocate per row.
 */
export function generate(options: GenerateOptions): SyntheticDataset {
  const { seed, rows } = options;
  const stationCount = options.stations ?? stationCountFor(rows);
  const start = options.start ?? toMinutes(Date.UTC(2024, 0, 1));
  const gapDays = new Set(options.gapDays ?? []);

  const random = mulberry32(seed);
  const { table, role, eShare } = generateStations(stationCount, random);
  const obs = allocateObservations(rows);

  // Per-station slow drift (AR(1)), so neighbouring samples are correlated like real occupancy.
  const drift = new Float32Array(stationCount);
  // Remaining closed steps per station (0 = open).
  const closedFor = new Uint16Array(stationCount);
  // About 1% of station-days see a closure, so closures are rare but visible in the charts.
  const closeChancePerStep = 0.01 / STEPS_PER_DAY;

  let row = 0;
  for (let step = 0; row < rows; step++) {
    const day = Math.floor(step / STEPS_PER_DAY);
    if (gapDays.has(day)) {
      step = (day + 1) * STEPS_PER_DAY - 1;
      continue;
    }
    const t = start + step * CADENCE_MINUTES;
    const hour = (((t + LOCAL_OFFSET_MINUTES) % MINUTES_PER_DAY) / MINUTES_PER_DAY) * 24;
    // 2018-01-01 (minute 0) is a Monday, so day-of-week is days since epoch mod 7; 5 and 6 are the weekend.
    const weekday = Math.floor(t / MINUTES_PER_DAY) % 7;
    const amplitude = weekday >= 5 ? 0.12 : 0.35;
    const shape = commuteShape(hour);

    for (let s = 0; s < stationCount && row < rows; s++, row++) {
      const cap = table.capacity[s] as number;
      obs.stationIdx[row] = s;
      obs.t[row] = t;

      let closed = closedFor[s] as number;
      if (closed === 0 && random() < closeChancePerStep) closed = 12 + Math.floor(random() * 60);
      if (closed > 0) {
        closedFor[s] = closed - 1;
        obs.status[row] = Status.Closed;
        continue; // bikes and docks stay 0: a closed station reports nothing available
      }

      const d = (drift[s] as number) * 0.98 + gaussian(random) * 0.02;
      drift[s] = d;
      const fill = Math.min(1, Math.max(0, 0.5 + amplitude * (role[s] as number) * shape + d));
      const bikes = Math.round(fill * cap);
      const elec = Math.min(bikes, Math.round(bikes * (eShare[s] as number) + (random() - 0.5)));

      obs.bikesElec[row] = elec;
      obs.bikesMech[row] = bikes - elec;
      obs.docks[row] = cap - bikes;
      obs.status[row] = Status.InService;
    }
  }

  return { stations: table, observations: obs };
}
