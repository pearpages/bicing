import { describe, expect, test } from 'vitest';
import { parseColor, rampBytes } from './colorRamp';

describe('parseColor', () => {
  test('reads the formats d3 interpolators produce', () => {
    expect(parseColor('rgb(68, 1, 84)')).toEqual([68, 1, 84, 255]);
    expect(parseColor('rgba(10, 20, 30, 0.5)')).toEqual([10, 20, 30, 128]);
    expect(parseColor('#fde725')).toEqual([253, 231, 37, 255]);
  });

  test('rejects anything it cannot parse instead of guessing', () => {
    expect(() => parseColor('steelblue')).toThrow(/Unsupported color/);
  });
});

describe('rampBytes', () => {
  test('samples both ends of the scale into RGBA texels', () => {
    const bytes = rampBytes((t) => (t < 0.5 ? '#000000' : '#ffffff'), 4);
    expect(bytes).toHaveLength(16);
    expect(Array.from(bytes.subarray(0, 4))).toEqual([0, 0, 0, 255]);
    expect(Array.from(bytes.subarray(12, 16))).toEqual([255, 255, 255, 255]);
  });
});
