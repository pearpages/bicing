import type { LineSeriesData, Viewport } from './types';

/** Test-only fixtures. Not exported from the package. */
export function linesOf(
  lines: readonly (readonly [number, number][])[],
  values?: readonly number[],
): LineSeriesData {
  const starts = [0];
  const xs: number[] = [];
  const ys: number[] = [];
  for (const line of lines) {
    for (const [x, y] of line) {
      xs.push(x);
      ys.push(y);
    }
    starts.push(xs.length);
  }
  return {
    x: Uint32Array.from(xs),
    y: Float32Array.from(ys),
    lineStarts: Uint32Array.from(starts),
    lineValue: Float32Array.from(values ?? lines.map(() => 0.5)),
  };
}

export const VIEW: Viewport = {
  xDomain: [0, 100],
  yDomain: [0, 10],
  width: 200,
  height: 100,
  dpr: 2,
};
