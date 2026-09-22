import { describe, expect, test } from 'vitest';
import { scenarioDomain } from './scenario';

const EXTENT = [1_000, 11_000] as const;

describe('scenarioDomain', () => {
  test('starts and ends at the full extent', () => {
    expect(scenarioDomain(0, EXTENT)).toEqual([1_000, 11_000]);
    const end = scenarioDomain(1, EXTENT);
    expect(end[0]).toBeCloseTo(1_000);
    expect(end[1]).toBeCloseTo(11_000);
  });

  test('pans at 5% zoom from 30% to 70% of the timeline', () => {
    const [a0, a1] = scenarioDomain(0.4, EXTENT);
    const [b0, b1] = scenarioDomain(0.8, EXTENT);
    expect(a1 - a0).toBeCloseTo(500);
    expect((a0 + a1) / 2).toBeCloseTo(4_000);
    expect((b0 + b1) / 2).toBeCloseTo(8_000);
  });

  test('every view stays inside the data and has a positive span', () => {
    for (let u = 0; u <= 1; u += 0.01) {
      const [d0, d1] = scenarioDomain(u, EXTENT);
      expect(d0).toBeGreaterThanOrEqual(1_000 - 1e-9);
      expect(d1).toBeLessThanOrEqual(11_000 + 1e-9);
      expect(d1).toBeGreaterThan(d0);
    }
  });

  test('is deterministic', () => {
    expect(scenarioDomain(0.123, EXTENT)).toEqual(scenarioDomain(0.123, EXTENT));
  });
});
