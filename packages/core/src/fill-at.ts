import { upperBound } from './search';
import type { StationSeries } from './station-series';

/**
 * How full each station is at time `t` (T2.7's map): its last reading at or before `t`, divided by
 * its capacity, in [0, 1]. A station with no reading in the last `series.maxGap` minutes, or no
 * capacity, gets NaN: "no data", never "empty" (P9). One binary search per station, so it's
 * O(stations × log n) and fine on the main thread.
 */
export function fillAt(
  series: StationSeries,
  capacity: ArrayLike<number>,
  t: number,
  out = new Float32Array(series.offsets.length - 1),
): Float32Array {
  const stations = series.offsets.length - 1;
  for (let s = 0; s < stations; s++) {
    const lo = series.offsets[s] as number;
    const hi = series.offsets[s + 1] as number;
    const last = upperBound(series.x, t, lo, hi) - 1;
    const cap = capacity[s] ?? 0;
    if (last < lo || t - (series.x[last] as number) > series.maxGap || cap === 0) {
      out[s] = Number.NaN;
      continue;
    }
    out[s] = Math.min(1, (series.y[last] as number) / cap);
  }
  return out;
}
