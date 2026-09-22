import fc from 'fast-check';

/** Test-only helpers shared by the decimator property tests. Not exported from the package. */
export interface Series {
  readonly x: Uint32Array;
  readonly y: Uint8Array;
}

/** Strictly increasing x with occasional big jumps (gaps), and y in 0..40 like bike counts. */
export const seriesArbitrary: fc.Arbitrary<Series> = fc
  .array(
    fc.tuple(
      fc.oneof(
        { weight: 9, arbitrary: fc.integer({ min: 1, max: 10 }) },
        { weight: 1, arbitrary: fc.integer({ min: 50, max: 500 }) },
      ),
      fc.integer({ min: 0, max: 40 }),
    ),
    { maxLength: 400 },
  )
  .map((steps) => {
    const x = new Uint32Array(steps.length);
    const y = new Uint8Array(steps.length);
    let t = 0;
    steps.forEach(([dx, value], i) => {
      t += dx;
      x[i] = t;
      y[i] = value;
    });
    return { x, y };
  });

export function sourceGaps(x: Uint32Array, start: number, end: number, maxGap: number): number[] {
  const gaps: number[] = [];
  for (let i = start + 1; i < end; i++) if ((x[i] ?? 0) - (x[i - 1] ?? 0) > maxGap) gaps.push(i);
  return gaps;
}

export function isStrictlyIncreasingWithin(
  indices: Uint32Array,
  start: number,
  end: number,
): boolean {
  for (let k = 0; k < indices.length; k++) {
    const v = indices[k] ?? -1;
    if (v < start || v >= end) return false;
    if (k > 0 && v <= (indices[k - 1] ?? -1)) return false;
  }
  return true;
}
