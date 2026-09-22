/** Index of the first element in [lo, hi) that is >= value, or hi if none. The input must be sorted ascending. */
export function lowerBound(
  sorted: ArrayLike<number>,
  value: number,
  lo = 0,
  hi = sorted.length,
): number {
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((sorted[mid] as number) < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Index of the first element in [lo, hi) that is > value, or hi if none. The input must be sorted ascending. */
export function upperBound(
  sorted: ArrayLike<number>,
  value: number,
  lo = 0,
  hi = sorted.length,
): number {
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((sorted[mid] as number) <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
