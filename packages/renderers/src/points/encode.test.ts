import { describe, expect, test } from 'vitest';
import { DIM_OFFSET, encodeValues } from './encode';

describe('encodeValues', () => {
  test('keeps fills in [0, 1] and marks no data as -1', () => {
    expect(Array.from(encodeValues([0, 0.5, 1, Number.NaN, 1.5, -0.2]))).toEqual([
      0, 0.5, 1, -1, 1, 0,
    ]);
  });

  test('dimmed points are shifted out of the no-data and ramp range, whatever their value', () => {
    const out = encodeValues([0.5, Number.NaN, 1, 0], Uint8Array.of(1, 1, 0, 1));
    expect(Array.from(out)).toEqual([0.5 + DIM_OFFSET, -1 + DIM_OFFSET, 1, DIM_OFFSET]);
    // The shader's threshold, 2, sits between [-1, 1] and [-1, 1] + DIM_OFFSET.
    expect(Array.from(out).every((v) => v <= 1 || v >= -1 + DIM_OFFSET)).toBe(true);
  });
});
