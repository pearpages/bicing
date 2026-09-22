import { lowerBound, type StationSeries } from '@bicing/core';

export interface Hit {
  readonly station: number;
  /** Row in the series arrays. */
  readonly index: number;
  /** Minutes since the epoch, and bikes available, of the picked sample. */
  readonly t: number;
  readonly y: number;
}

/**
 * The sample closest in y to `yValue` at time `t`, across all stations. A binary search per
 * station, so O(stations × log n) and exact on full-resolution data, with no index to rebuild when
 * the view changes (ADR 0008).
 *
 * A station only counts if it actually has a reading near `t`: the nearest sample must be within
 * maxGap / 2. Inside a gap (a closure or a missing day) nothing is picked, just as nothing is
 * drawn (P9). `maxYDistance` (data units) keeps a hover far from every line from latching onto one.
 */
export function pickAt(
  series: StationSeries,
  t: number,
  yValue: number,
  maxYDistance: number,
): Hit | null {
  const stations = series.offsets.length - 1;
  const maxTimeDistance = series.maxGap / 2;
  let best: Hit | null = null;
  let bestDy = maxYDistance;
  for (let s = 0; s < stations; s++) {
    const lo = series.offsets[s] as number;
    const hi = series.offsets[s + 1] as number;
    if (hi === lo) continue;
    const i = lowerBound(series.x, t, lo, hi);
    let index = -1;
    let dt = Number.POSITIVE_INFINITY;
    if (i < hi) {
      index = i;
      dt = (series.x[i] as number) - t;
    }
    if (i > lo && t - (series.x[i - 1] as number) < dt) {
      index = i - 1;
      dt = t - (series.x[i - 1] as number);
    }
    if (index < 0 || dt > maxTimeDistance) continue;
    const y = series.y[index] as number;
    const dy = Math.abs(y - yValue);
    // Strictly smaller: on ties the lower station index wins, so the pick is deterministic.
    if (dy < bestDy || (best === null && dy <= bestDy)) {
      best = { station: s, index, t: series.x[index] as number, y };
      bestDy = dy;
    }
  }
  return best;
}
