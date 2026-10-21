import { MINUTES_PER_DAY } from '@bicing/core';
import { describe, expect, test } from 'vitest';
import { needsReload, pickLevel, windowFor, type Domain } from './historyView';

const DAY = MINUTES_PER_DAY;
const EXTENT: Domain = [0, 2_000 * DAY];

describe('the whole-history level policy', () => {
  test('raw up to a week, hourly up to 60 days, daily beyond', () => {
    expect(pickLevel(DAY)).toBe('raw');
    expect(pickLevel(7 * DAY)).toBe('raw');
    expect(pickLevel(7 * DAY + 1)).toBe('1h');
    expect(pickLevel(60 * DAY)).toBe('1h');
    expect(pickLevel(60 * DAY + 1)).toBe('1d');
    expect(pickLevel(EXTENT[1])).toBe('1d');
  });

  test('loads the view plus one span each side, clamped; the daily level loads whole', () => {
    expect(windowFor('raw', [10 * DAY, 12 * DAY], EXTENT)).toEqual([8 * DAY, 14 * DAY]);
    expect(windowFor('1h', [DAY, 31 * DAY], EXTENT)).toEqual([0, 61 * DAY]);
    expect(windowFor('1d', [DAY, 900 * DAY], EXTENT)).toEqual(EXTENT);
  });

  test('reloads only when the level changes or the view leaves the window', () => {
    const loaded = { level: 'raw' as const, window: [8 * DAY, 14 * DAY] as Domain };
    expect(needsReload(loaded, [10 * DAY, 12 * DAY])).toBe(false);
    expect(needsReload(loaded, [9 * DAY, 11 * DAY])).toBe(false);
    expect(needsReload(loaded, [7 * DAY, 9 * DAY])).toBe(true);
    // Zooming out past a week switches to hourly buckets, even inside the window.
    expect(needsReload({ level: 'raw', window: [0, 30 * DAY] }, [DAY, 10 * DAY])).toBe(true);
  });
});
