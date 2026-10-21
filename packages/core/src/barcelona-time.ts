import { EPOCH_MS, MINUTES_PER_DAY, toMinutes } from './time';

/**
 * Barcelona's hour of day, for the crossfilter's hour dimension (ADR 0015): commuting happens in
 * local time. `Intl` is far too slow per row, so the EU rule is applied directly: CET (UTC+1), and
 * CEST (UTC+2) from 01:00 UTC on the last Sunday of March to 01:00 UTC on the last Sunday of October.
 */

const CET = 60;
const CEST = 120;

/** 01:00 UTC on the last Sunday of a month (0-based), in minutes since the epoch. */
function lastSundayAt1Utc(year: number, month: number): number {
  const lastDay = new Date(Date.UTC(year, month + 1, 0));
  const sunday = lastDay.getUTCDate() - lastDay.getUTCDay();
  return toMinutes(Date.UTC(year, month, sunday, 1));
}

/** The UTC offset in Barcelona at `t` (minutes since the epoch), in minutes. */
export function barcelonaOffset(t: number): number {
  const year = new Date(EPOCH_MS + t * 60_000).getUTCFullYear();
  return t >= lastSundayAt1Utc(year, 2) && t < lastSundayAt1Utc(year, 9) ? CEST : CET;
}

/**
 * The local hour (0–23) of each time. Times in ascending order (the store's order) are walked
 * against the year's two switches, so the cost is one comparison per row; out-of-order input is
 * still correct, just slower.
 */
export function barcelonaHours(
  times: ArrayLike<number>,
  out = new Uint8Array(times.length),
): Uint8Array {
  let summerStart = 0;
  let summerEnd = 0;
  let nextYear = Number.NEGATIVE_INFINITY;
  let yearStart = Number.POSITIVE_INFINITY;
  for (let i = 0; i < times.length; i++) {
    const t = times[i] as number;
    if (t >= nextYear || t < yearStart) {
      const year = new Date(EPOCH_MS + t * 60_000).getUTCFullYear();
      summerStart = lastSundayAt1Utc(year, 2);
      summerEnd = lastSundayAt1Utc(year, 9);
      yearStart = toMinutes(Date.UTC(year, 0, 1));
      nextYear = toMinutes(Date.UTC(year + 1, 0, 1));
    }
    const local = t + (t >= summerStart && t < summerEnd ? CEST : CET);
    out[i] = Math.floor((((local % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY) / 60);
  }
  return out;
}
