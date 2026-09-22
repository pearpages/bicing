import { describe, expect, test } from 'vitest';
import { projectionFor } from '../projection';
import type { Viewport } from '../types';
import { shaderX, xUniforms } from './uniforms';

describe('xUniforms (float32 precision)', () => {
  // Zoomed to 10 minutes across 1000 px, deep in 2024 (about 3.4M minutes after the epoch).
  const x0 = 3_400_000.37;
  const view: Viewport = {
    xDomain: [x0, x0 + 10],
    yDomain: [0, 40],
    width: 1_000,
    height: 300,
    dpr: 1,
  };

  test('the split origin keeps sub-pixel accuracy', () => {
    const u = xUniforms(view);
    const exact = (t: number) => (t - x0) * projectionFor(view).kx;
    for (const t of [3_400_001, 3_400_005, 3_400_010]) {
      expect(Math.abs(shaderX(t, u) - exact(t))).toBeLessThan(0.01);
    }
  });

  test('the naive float32 version is off by many pixels (why the split exists)', () => {
    const f = Math.fround;
    const kx = projectionFor(view).kx;
    const naive = (t: number) => f(f(f(t) - f(x0)) * f(kx));
    const exact = (t: number) => (t - x0) * kx;
    expect(Math.abs(naive(3_400_005) - exact(3_400_005))).toBeGreaterThan(5);
  });
});
