import { describe, expect, test } from 'vitest';
import { backingStoreSize } from './dpr';

describe('backingStoreSize', () => {
  test('scales by devicePixelRatio and rounds to whole pixels', () => {
    expect(backingStoreSize(300, 150, 2)).toEqual({ width: 600, height: 300 });
    expect(backingStoreSize(301, 151, 1.5)).toEqual({ width: 452, height: 227 });
  });

  test('never returns zero, and falls back to 1 for invalid ratios', () => {
    expect(backingStoreSize(0, 0, 2)).toEqual({ width: 1, height: 1 });
    expect(backingStoreSize(100, 50, 0)).toEqual({ width: 100, height: 50 });
    expect(backingStoreSize(100, 50, Number.NaN)).toEqual({ width: 100, height: 50 });
  });
});
