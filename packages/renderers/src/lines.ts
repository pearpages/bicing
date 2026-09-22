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
