import { describe, expect, test } from 'vitest';
import { groupLinesByBucket, paletteBucket, samplePalette } from './palette';

describe('palette', () => {
  test('samples the interpolator at evenly spaced stops, including both ends', () => {
    expect(samplePalette((t) => t.toFixed(2), 3)).toEqual(['0.00', '0.50', '1.00']);
  });

  test('buckets clamp out-of-range and NaN values', () => {
    expect([
      paletteBucket(-1, 4),
      paletteBucket(0, 4),
      paletteBucket(1, 4),
      paletteBucket(2, 4),
    ]).toEqual([0, 0, 3, 3]);
    expect(paletteBucket(Number.NaN, 4)).toBe(0);
  });

  test('groups every line exactly once, by bucket', () => {
    const groups = groupLinesByBucket(Float32Array.of(0, 1, 0, 0.5), 3);
    expect(groups.map((g) => Array.from(g))).toEqual([[0, 2], [3], [1]]);
  });
});
