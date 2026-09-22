import type { Viewport } from './types';

/**
 * Linear data → CSS-pixel mapping for one frame. Deliberately not a d3-scale: renderers only need
 * the affine coefficients, and the charts package owns the D3 scales and hands over the domains.
 * The formulas match d3's scaleLinear (a range of [0, width] and [height, 0]).
 */
export interface Projection {
  readonly kx: number;
  readonly bx: number;
  readonly ky: number;
  readonly by: number;
}

export function projectionFor(view: Viewport): Projection {
  const [x0, x1] = view.xDomain;
  const [y0, y1] = view.yDomain;
  const kx = x1 === x0 ? 0 : view.width / (x1 - x0);
  const ky = y1 === y0 ? 0 : -view.height / (y1 - y0);
  return { kx, bx: -x0 * kx, ky, by: view.height - y0 * ky };
}
