/**
 * Timestamps are stored as whole minutes since EPOCH_MS in a Uint32Array.
 * - The source data has 5-minute cadence, so minute resolution loses nothing.
 * - A 2018 epoch keeps values below 2^24 (~31.9 years), so they stay exact when converted
 *   to float32 for the GPU.
 */
export type TimeMinutes = number;

export const EPOCH_MS = Date.UTC(2018, 0, 1);
export const MS_PER_MINUTE = 60_000;
export const MINUTES_PER_DAY = 1_440;

export function toMinutes(epochMs: number): TimeMinutes {
  return Math.floor((epochMs - EPOCH_MS) / MS_PER_MINUTE);
}

export function toEpochMs(minutes: TimeMinutes): number {
  return EPOCH_MS + minutes * MS_PER_MINUTE;
}
