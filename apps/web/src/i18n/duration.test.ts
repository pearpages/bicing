import { describe, expect, test } from 'vitest';
import { duration } from './duration';

const ca = { day: 'dia', days: 'dies' };

describe('duration', () => {
  test('minutes, then hours and minutes, then days', () => {
    expect(duration(40, ca)).toBe('40 min');
    expect(duration(60, ca)).toBe('1 h');
    expect(duration(200, ca)).toBe('3 h 20 min');
    expect(duration(2_879, ca)).toBe('47 h 59 min');
    expect(duration(2_880, ca)).toBe('2 dies');
    expect(duration(12 * 1_440 + 300, ca)).toBe('12 dies');
  });
});
