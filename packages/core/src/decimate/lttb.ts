import { segmentStarts } from '../series';
import { IndexBuffer, type Decimated } from './result';

/**
 * Largest-Triangle-Three-Buckets (Steinarsson, 2013). Keeps a fixed budget of points that preserve
 * the *shape* of the series: in each bucket it picks the point that forms the largest triangle
 * with the previously kept point and the average of the next bucket.
 *
 * Unlike min/max-per-pixel it isn't pixel-exact (lone spikes inside a bucket can lose to bigger
 * triangles), but its output size is fixed, which is what matters when the point budget is the
 * constraint (SVG baseline, tooltips, exports).
 *
 * Gaps (steps > maxGap) split the input into segments. Each segment gets a share of the budget
 * proportional to its length and always keeps its endpoints, so the output has at most
 * max(threshold, 2 × segments) points. Gap boundaries win over the budget (P9).
 */
export function lttb(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  start: number,
  end: number,
  threshold: number,
  maxGap = Number.POSITIVE_INFINITY,
): Decimated {
  const n = end - start;
  if (n <= 0 || threshold <= 0) {
    return { indices: new Uint32Array(0), segmentStarts: new Uint32Array(0) };
  }

  const bounds = segmentStarts(x, start, end, maxGap);
  const segmentCount = bounds.length;
  const segmentEnd = (s: number): number =>
    s + 1 < segmentCount ? (bounds[s + 1] as number) : end;

  // Endpoints are mandatory (up to 2 per segment). Only the remaining budget is shared, in
  // proportion to each segment's spare points, so rounding can never exceed the bound.
  let mandatory = 0;
  for (let s = 0; s < segmentCount; s++) {
    mandatory += Math.min(2, segmentEnd(s) - (bounds[s] as number));
  }
  const spareTotal = n - mandatory;
  const shared = Math.max(0, threshold - mandatory);

  const out = new IndexBuffer(Math.min(n, Math.max(threshold, mandatory)));
  const segments = new IndexBuffer(segmentCount);
  for (let s = 0; s < segmentCount; s++) {
    const segStart = bounds[s] as number;
    const segEnd = segmentEnd(s);
    const len = segEnd - segStart;
    const must = Math.min(2, len);
    const extra = spareTotal === 0 ? 0 : Math.floor((shared * (len - must)) / spareTotal);
    segments.push(out.length);
    lttbSegment(x, y, segStart, segEnd, must + extra, out);
  }

  return { indices: out.toArray(), segmentStarts: segments.toArray() };
}

function lttbSegment(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  start: number,
  end: number,
  budget: number,
  out: IndexBuffer,
): void {
  const len = end - start;
  if (budget >= len || len <= 2) {
    for (let i = start; i < end; i++) out.push(i);
    return;
  }

  // The endpoints are fixed; the budget - 2 buckets in between share the remaining len - 2 points.
  const bucketSize = (len - 2) / (budget - 2);
  let a = start;
  out.push(a);

  for (let b = 0; b < budget - 2; b++) {
    const from = start + 1 + Math.floor(b * bucketSize);
    const to = start + 1 + Math.floor((b + 1) * bucketSize);

    // Average of the next bucket (the last point, for the final bucket).
    const nextFrom = to;
    const nextTo = Math.min(end, start + 1 + Math.floor((b + 2) * bucketSize));
    let avgX = 0;
    let avgY = 0;
    const count = Math.max(1, nextTo - nextFrom);
    if (nextTo > nextFrom) {
      for (let j = nextFrom; j < nextTo; j++) {
        avgX += x[j] as number;
        avgY += y[j] as number;
      }
      avgX /= count;
      avgY /= count;
    } else {
      avgX = x[end - 1] as number;
      avgY = y[end - 1] as number;
    }

    const ax = x[a] as number;
    const ay = y[a] as number;
    let best = from;
    let bestArea = -1;
    for (let j = from; j < to; j++) {
      // Twice the triangle area; the constant factor doesn't change which point wins.
      const area = Math.abs(
        (ax - avgX) * ((y[j] as number) - ay) - (ax - (x[j] as number)) * (avgY - ay),
      );
      if (area > bestArea) {
        bestArea = area;
        best = j;
      }
    }
    out.push(best);
    a = best;
  }

  out.push(end - 1);
}
