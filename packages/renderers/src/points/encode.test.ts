import { describe, expect, test } from 'vitest';
import { encodeValues } from './encode';

describe('encodeValues', () => {
  test('keeps fills in [0, 1] and marks no data as -1', () => {
    expect(Array.from(encodeValues([0, 0.5, 1, Number.NaN, 1.5, -0.2]))).toEqual([
      0, 0.5, 1, -1, 1, 0,
    ]);
  });
});
