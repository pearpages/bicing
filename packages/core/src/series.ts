import type { TypedArray } from './typed-array';

/**
 * Rows grouped by station: series s is order[offsets[s]] ... order[offsets[s + 1] - 1].
 * Because the store is sorted by (t, stationIdx), a *stable* counting sort by station leaves each
 * series already sorted by t. That makes it O(n) with no comparisons, instead of O(n log n).
 */
export interface SeriesIndex {
  readonly order: Uint32Array;
  readonly offsets: Uint32Array;
}

export function buildSeriesIndex(stationIdx: Uint16Array, stationCount: number): SeriesIndex {
  const offsets = new Uint32Array(stationCount + 1);
  for (const s of stationIdx) {
    if (s >= stationCount)
      throw new RangeError(`stationIdx ${String(s)} >= ${String(stationCount)}`);
    offsets[s + 1] = (offsets[s + 1] as number) + 1;
  }
  for (let s = 0; s < stationCount; s++)
    offsets[s + 1] = (offsets[s + 1] as number) + (offsets[s] as number);

  const cursor = offsets.slice(0, stationCount);
  const order = new Uint32Array(stationIdx.length);
  for (let i = 0; i < stationIdx.length; i++) {
    const s = stationIdx[i] as number;
    const at = cursor[s] as number;
    order[at] = i;
    cursor[s] = at + 1;
  }
  return { order, offsets };
}

/**
 * Copies `source[order[i]]` into a new contiguous array of the same type. Done once per dataset, so
 * that per-frame work (decimation, GPU upload) streams through memory in order instead of
 * chasing indices.
 */
export function gather<T extends TypedArray>(source: T, order: Uint32Array): T {
  const out = new (source.constructor as new (length: number) => T)(order.length);
  for (let i = 0; i < order.length; i++) out[i] = source[order[i] as number] as number;
  return out;
}

/**
 * Starts of the gap-free runs in x[start, end): a new run starts wherever consecutive x values
 * are more than maxGap apart. `start` is always the first entry (if the range isn't empty).
 * Renderers break lines there, so gaps are never interpolated across (P9).
 */
export function segmentStarts(
  x: ArrayLike<number>,
  start: number,
  end: number,
  maxGap: number,
): Uint32Array {
  if (end <= start) return new Uint32Array(0);
  const starts: number[] = [start];
  for (let i = start + 1; i < end; i++) {
    if ((x[i] as number) - (x[i - 1] as number) > maxGap) starts.push(i);
  }
  return Uint32Array.from(starts);
}
