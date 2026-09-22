import { describe, expect, test } from 'vitest';
import { visibleRange } from './lines';
import { linesOf } from './testing';

describe('visibleRange', () => {
  const data = linesOf([
    [
      [0, 1],
      [10, 1],
      [20, 1],
      [30, 1],
      [40, 1],
    ],
    [
      [100, 1],
      [110, 1],
    ],
  ]);

  test('keeps one extra point on each side so lines reach the plot edges', () => {
    expect(visibleRange(data, 0, 15, 25)).toEqual({ start: 1, end: 4 });
  });

  test('clamps to the line and never crosses into the next one', () => {
    expect(visibleRange(data, 0, 0, 1_000)).toEqual({ start: 0, end: 5 });
    expect(visibleRange(data, 1, 0, 1_000)).toEqual({ start: 5, end: 7 });
  });

  test('a line entirely outside the view is empty or only an edge neighbor', () => {
    const r = visibleRange(data, 1, 0, 40);
    expect(r.end - r.start).toBeLessThanOrEqual(1);
  });
});
