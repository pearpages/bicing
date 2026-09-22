import {
  lowerBound,
  lttb,
  minMaxPerPixel,
  upperBound,
  type Decimated,
  type StationSeries,
} from '@bicing/core';
import type { LineSeriesData } from '@bicing/renderers';

export type Decimation = 'none' | 'minmax' | 'lttb';

/**
 * Every in-service reading as gap-free lines. The line table was precomputed in the worker, so this is
 * O(lines) and copies nothing: x and y are the series' own arrays, which is what WebGL uploads at
 * full resolution.
 */
export function fullLines(series: StationSeries): LineSeriesData {
  const lineValue = new Float32Array(series.lineStation.length);
  for (let k = 0; k < lineValue.length; k++) {
    lineValue[k] = series.meanFill[series.lineStation[k] as number] as number;
  }
  return { x: series.x, y: series.y, lineStarts: series.lineStarts, lineValue };
}

/** Station s's rows that are visible in [x0, x1], plus one neighbor on each side so lines reach the edges. */
export function visibleStationRange(
  series: StationSeries,
  station: number,
  x0: number,
  x1: number,
): { start: number; end: number } {
  const lo = series.offsets[station] as number;
  const hi = series.offsets[station + 1] as number;
  const start = Math.max(lo, lowerBound(series.x, x0, lo, hi) - 1);
  const end = Math.min(hi, upperBound(series.x, x1, lo, hi) + 1);
  return { start, end: Math.max(start, end) };
}

/** Points inside the view across all stations: O(stations × log n). Used to decide whether live re-decimation fits in a frame. */
export function visiblePointCount(series: StationSeries, x0: number, x1: number): number {
  let total = 0;
  const stations = series.offsets.length - 1;
  for (let s = 0; s < stations; s++) {
    const { start, end } = visibleStationRange(series, s, x0, x1);
    total += end - start;
  }
  return total;
}

/**
 * Decimates each station's visible slice, then packs the kept points into one LineSeriesData. The
 * output is a copy, but a small one: bounded by stations × pixels, not by the dataset.
 *
 * Note the ceiling this implies (ADR 0006): with ~500 overlapping series, min/max can keep up to
 * 4 × pixels points *per series*, so decimation only pays off once each series has many more
 * points than that. Below that, drawing everything on the GPU wins, which the benchmark shows.
 */
export function decimatedLines(
  series: StationSeries,
  mode: Exclude<Decimation, 'none'>,
  x0: number,
  x1: number,
  pixels: number,
): LineSeriesData {
  const { maxGap } = series;
  const stations = series.offsets.length - 1;
  const parts: { station: number; result: Decimated }[] = [];
  let points = 0;
  let lines = 0;
  for (let s = 0; s < stations; s++) {
    const { start, end } = visibleStationRange(series, s, x0, x1);
    if (end <= start) continue;
    const result =
      mode === 'minmax'
        ? minMaxPerPixel(series.x, series.y, start, end, x0, x1, pixels, maxGap)
        : lttb(series.x, series.y, start, end, pixels, maxGap);
    parts.push({ station: s, result });
    points += result.indices.length;
    lines += result.segmentStarts.length;
  }

  const x = new Uint32Array(points);
  const y = new Uint8Array(points);
  const lineStarts = new Uint32Array(lines + 1);
  const lineValue = new Float32Array(lines);
  let p = 0;
  let l = 0;
  for (const { station, result } of parts) {
    const { indices, segmentStarts: segs } = result;
    for (const seg of segs) {
      lineStarts[l] = p + seg;
      lineValue[l] = series.meanFill[station] as number;
      l++;
    }
    for (const index of indices) {
      x[p] = series.x[index] as number;
      y[p] = series.y[index] as number;
      p++;
    }
  }
  lineStarts[lines] = points;
  return { x, y, lineStarts, lineValue };
}
