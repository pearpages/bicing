import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { lowerBound, upperBound } from './search';

const sortedArray = fc
  .array(fc.integer({ min: 0, max: 50 }), { maxLength: 200 })
  .map((values) => Uint32Array.from(values.sort((a, b) => a - b)));

function linearLowerBound(arr: ArrayLike<number>, value: number): number {
  for (let i = 0; i < arr.length; i++) if ((arr[i] as number) >= value) return i;
  return arr.length;
}

function linearUpperBound(arr: ArrayLike<number>, value: number): number {
  for (let i = 0; i < arr.length; i++) if ((arr[i] as number) > value) return i;
  return arr.length;
}

describe('lowerBound / upperBound', () => {
  test('empty input returns 0', () => {
    expect(lowerBound(new Uint32Array(0), 5)).toBe(0);
    expect(upperBound(new Uint32Array(0), 5)).toBe(0);
  });

  test('single element: below, equal, above', () => {
    const one = Uint32Array.of(10);
    expect([lowerBound(one, 9), lowerBound(one, 10), lowerBound(one, 11)]).toEqual([0, 0, 1]);
    expect([upperBound(one, 9), upperBound(one, 10), upperBound(one, 11)]).toEqual([0, 1, 1]);
  });

  test('runs of duplicates bracket the equal range', () => {
    const arr = Uint32Array.of(1, 3, 3, 3, 7);
    expect(lowerBound(arr, 3)).toBe(1);
    expect(upperBound(arr, 3)).toBe(4);
  });

  test('respects an explicit [lo, hi) window', () => {
    const arr = Uint32Array.of(0, 5, 5, 5, 9);
    expect(lowerBound(arr, 5, 2, 4)).toBe(2);
    expect(upperBound(arr, 5, 2, 4)).toBe(4);
    expect(lowerBound(arr, 100, 1, 3)).toBe(3);
  });

  test('property: matches a linear scan', () => {
    fc.assert(
      fc.property(sortedArray, fc.integer({ min: -5, max: 55 }), (arr, value) => {
        expect(lowerBound(arr, value)).toBe(linearLowerBound(arr, value));
        expect(upperBound(arr, value)).toBe(linearUpperBound(arr, value));
      }),
    );
  });
});
