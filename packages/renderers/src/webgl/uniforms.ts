import { projectionFor } from '../projection';
import type { Viewport } from '../types';

/**
 * The x-mapping split so the GPU computes it without float32 precision loss.
 *
 * x is minutes since 2018 (about 3.4M in 2024). float32 has 24 bits of mantissa, so a fractional x0
 * like 3_400_000.37 rounds to a multiple of 0.25. When zoomed to a few minutes across the screen, that
 * error is tens of pixels of jitter. So the shader computes `int(a_x) - xOrigin` in exact integer
 * math first, and only the small difference becomes a float:
 *
 *   px = (float(int(a_x) - xOrigin) - xFrac) * kx
 */
export interface XUniforms {
  readonly xOrigin: number;
  readonly xFrac: number;
  readonly kx: number;
}

export function xUniforms(view: Viewport): XUniforms {
  const x0 = view.xDomain[0];
  const xOrigin = Math.floor(x0);
  return { xOrigin, xFrac: x0 - xOrigin, kx: projectionFor(view).kx };
}

/** Float32 emulation of the shader's x math, so tests can compare it with the naive version. */
export function shaderX(x: number, u: XUniforms): number {
  const f = Math.fround;
  return f(f(f(x - u.xOrigin) - f(u.xFrac)) * f(u.kx));
}
