import { describe, expect, test } from 'vitest';
import { EPOCH_MS, toEpochMs, toMinutes } from './time';

describe('time', () => {
  test('the epoch is minute 0', () => {
    expect(toMinutes(EPOCH_MS)).toBe(0);
    expect(new Date(toEpochMs(0)).toISOString()).toBe('2018-01-01T00:00:00.000Z');
  });

  test('round-trips whole minutes and floors partial ones', () => {
    const ms = Date.UTC(2024, 5, 15, 8, 35);
    expect(toEpochMs(toMinutes(ms))).toBe(ms);
    expect(toMinutes(ms + 59_999)).toBe(toMinutes(ms));
  });

  test('the whole Bicing history stays exact in float32 (below 2^24 minutes)', () => {
    const endOf2030 = toMinutes(Date.UTC(2030, 11, 31, 23, 59));
    expect(endOf2030).toBeLessThan(2 ** 24);
    expect(Math.fround(endOf2030)).toBe(endOf2030);
  });
});
