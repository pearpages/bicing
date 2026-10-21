import { lowerBound, upperBound } from '@bicing/core';
import type { LineSeriesData } from './types';

/**
 * Visible sub-range of line k for x in [x0, x1], widened by one point on each side so the line
 * still reaches the plot edges. O(log n) per line because x is sorted within a line.
 */
export function visibleRange(
  data: LineSeriesData,
  line: number,
  x0: number,
  x1: number,
): { start: number; end: number } {
  const lineStart = data.lineStarts[line] as number;
  const lineEnd = data.lineStarts[line + 1] as number;
  const start = Math.max(lineStart, lowerBound(data.x, x0, lineStart, lineEnd) - 1);
  const end = Math.min(lineEnd, upperBound(data.x, x1, lineStart, lineEnd) + 1);
  return { start, end: Math.max(start, end) };
}

export function lineCount(data: LineSeriesData): number {
  return data.lineStarts.length - 1;
}

export interface DrawList {
  /** Entries used in `firsts`/`counts`. */
  readonly drawCount: number;
  /** The first `dimmedCount` entries are dimmed lines, drawn first and fainter (ADR 0015). */
  readonly dimmedCount: number;
  readonly points: number;
}

/**
 * Fills `firsts`/`counts` (one slot per line) with the visible part of each line that has at least
 * two points, dimmed lines first. O(lines × log n): only the slice and the order change per frame (P6).
 */
export function fillDrawList(
  data: LineSeriesData,
  x0: number,
  x1: number,
  dimmed: Uint8Array | null,
  firsts: Int32Array,
  counts: Int32Array,
): DrawList {
  const lines = lineCount(data);
  let drawCount = 0;
  let dimmedCount = 0;
  let points = 0;
  for (const pass of dimmed ? [1, 0] : [0]) {
    for (let k = 0; k < lines; k++) {
      if (dimmed && (dimmed[k] === 1 ? 1 : 0) !== pass) continue;
      const { start, end } = visibleRange(data, k, x0, x1);
      if (end - start < 2) continue;
      firsts[drawCount] = start;
      counts[drawCount] = end - start;
      drawCount++;
      points += end - start;
    }
    if (pass === 1) dimmedCount = drawCount;
  }
  return { drawCount, dimmedCount, points };
}
