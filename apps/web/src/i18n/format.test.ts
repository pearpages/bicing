import { describe, expect, test } from 'vitest';
import { numberFormats } from './format';

describe('numberFormats', () => {
  const ca = numberFormats('ca-ES');
  const en = numberFormats('en-GB');

  test('groups thousands and marks decimals the way each locale does', () => {
    expect(ca.int(10_000_000)).toBe('10.000.000');
    expect(en.int(10_000_000)).toBe('10,000,000');
    expect(ca.ms(16.66)).toBe('16,7 ms');
    expect(en.ms(16.66)).toBe('16.7 ms');
  });

  test('fixed keeps the requested decimals', () => {
    expect(ca.fixed(1, 1)).toBe('1,0');
    expect(en.fixed(59.6, 0)).toBe('60');
  });

  test('durations switch to seconds at one second', () => {
    expect(ca.duration(573)).toBe('573 ms');
    expect(ca.duration(3_176)).toBe('3,2 s');
    expect(en.duration(3_176)).toBe('3.2 s');
  });
});
