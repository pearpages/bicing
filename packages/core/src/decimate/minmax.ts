import { IndexBuffer, type Decimated } from './result';

/**
 * Min/max-per-pixel decimation (also called M4). For every pixel column it keeps the first, min,
 * max and last point, in source order. Drawn as a line, the result is pixel-identical to drawing
 * every point: the vertical extent of each column and the connections between columns are all
 * preserved. Cost is O(n) over the visible slice, and output is at most about 4 × pixels.
 *
 * Buckets are keyed by pixel column without clamping, so points just outside [x0, x1] (which
 * callers include so lines reach the edges) get their own buckets instead of distorting the edge
 * columns. A gap (a step larger than maxGap) closes the current bucket and starts a new segment (P9).
 */
export function minMaxPerPixel(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  start: number,
  end: number,
  x0: number,
  x1: number,
  pixels: number,
  maxGap = Number.POSITIVE_INFINITY,
): Decimated {
  if (end <= start || pixels <= 0 || !(x1 > x0)) {
    return { indices: new Uint32Array(0), segmentStarts: new Uint32Array(0) };
  }
  const out = new IndexBuffer(Math.min(end - start, 4 * (pixels + 2)));
  const segments = new IndexBuffer(4);

  const scale = pixels / (x1 - x0);
  let bucket = Math.floor(((x[start] as number) - x0) * scale);
  let first = start;
  let minI = start;
  let maxI = start;
  let minY = y[start] as number;
  let maxY = minY;
  segments.push(0);

  const flush = (last: number): void => {
    // Emit up to four distinct indices in ascending order. min and max can come in either order.
    const lo = minI < maxI ? minI : maxI;
    const hi = minI < maxI ? maxI : minI;
    out.push(first);
    if (lo !== first) out.push(lo);
    if (hi !== lo && hi !== first) out.push(hi);
    if (last !== hi && last !== first) out.push(last);
  };

  for (let i = start + 1; i < end; i++) {
    const xi = x[i] as number;
    const yi = y[i] as number;
    const b = Math.floor((xi - x0) * scale);
    const isGap = xi - (x[i - 1] as number) > maxGap;
    if (b !== bucket || isGap) {
      flush(i - 1);
      if (isGap) segments.push(out.length);
      bucket = b;
      first = minI = maxI = i;
      minY = maxY = yi;
    } else if (yi < minY) {
      minY = yi;
      minI = i;
    } else if (yi > maxY) {
      maxY = yi;
      maxI = i;
    }
  }
  flush(end - 1);

  return { indices: out.toArray(), segmentStarts: segments.toArray() };
}
