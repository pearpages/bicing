import { describe, expect, test } from 'vitest';
import { projectionFor } from './projection';
import { VIEW } from './testing';

describe('projectionFor', () => {
  test('maps the domain corners onto the plot like d3.scaleLinear (y inverted)', () => {
    const { kx, bx, ky, by } = projectionFor(VIEW);
    expect([0 * kx + bx, 100 * kx + bx]).toEqual([0, 200]);
    expect([0 * ky + by, 10 * ky + by]).toEqual([100, 0]);
    expect(50 * kx + bx).toBe(100);
  });

  test('a zero-width domain collapses instead of producing Infinity', () => {
    const p = projectionFor({ ...VIEW, xDomain: [5, 5], yDomain: [3, 3] });
    expect(Number.isFinite(p.kx) && Number.isFinite(p.ky)).toBe(true);
  });
});
