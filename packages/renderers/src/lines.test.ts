import { describe, expect, test } from 'vitest';
import { fillDrawList, visibleRange } from './lines';
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

describe('fillDrawList', () => {
  const line: [number, number][] = [
    [0, 1],
    [50, 2],
    [100, 3],
  ];
  const data = linesOf([line, line, [[50, 1]], line]);
  const slots = () => ({ firsts: new Int32Array(4), counts: new Int32Array(4) });

  test('without dimming: every line with two visible points, in order', () => {
    const { firsts, counts } = slots();
    const list = fillDrawList(data, 0, 100, null, firsts, counts);
    // Line 2 is a single point: a LINE_STRIP can't draw it.
    expect(list).toEqual({ drawCount: 3, dimmedCount: 0, points: 9 });
    expect(Array.from(firsts.subarray(0, 3))).toEqual([0, 3, 7]);
  });

  test('dimmed lines come first, so they draw under the selection', () => {
    const { firsts, counts } = slots();
    const list = fillDrawList(data, 0, 100, Uint8Array.of(0, 1, 0, 1), firsts, counts);
    expect(list).toEqual({ drawCount: 3, dimmedCount: 2, points: 9 });
    expect(Array.from(firsts.subarray(0, 3))).toEqual([3, 7, 0]);
    expect(Array.from(counts.subarray(0, 3))).toEqual([3, 3, 3]);
  });

  test('everything dimmed, or nothing visible', () => {
    const { firsts, counts } = slots();
    expect(fillDrawList(data, 0, 100, Uint8Array.of(1, 1, 1, 1), firsts, counts)).toEqual({
      drawCount: 3,
      dimmedCount: 3,
      points: 9,
    });
    expect(fillDrawList(data, 500, 600, Uint8Array.of(1, 0, 0, 0), firsts, counts)).toEqual({
      drawCount: 0,
      dimmedCount: 0,
      points: 0,
    });
  });
});
