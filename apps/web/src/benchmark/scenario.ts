/**
 * The scripted camera path, a pure function of progress u ∈ [0, 1]. Every renderer and size
 * sees exactly the same sequence of views, so runs are comparable (P19):
 *
 *   0.0 – 0.4  zoom from the full extent to 5% of it, centered at 30% of the timeline
 *   0.4 – 0.8  pan at that zoom from 30% to 70%
 *   0.8 – 1.0  zoom back out to the full extent
 *
 * The span interpolates geometrically, as a wheel zoom does, so each frame zooms by the same factor.
 */
export const SCENARIO_MS = 5_000;
const DEEP_SPAN = 0.05;

function smoothstep(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function scenarioDomain(u: number, extent: readonly [number, number]): [number, number] {
  const [x0, x1] = extent;
  const full = x1 - x0;
  let span: number;
  let center: number;
  if (u < 0.4) {
    const t = smoothstep(u / 0.4);
    span = full * Math.pow(DEEP_SPAN, t);
    center = lerp(0.5, 0.3, t);
  } else if (u < 0.8) {
    span = full * DEEP_SPAN;
    center = lerp(0.3, 0.7, smoothstep((u - 0.4) / 0.4));
  } else {
    const t = smoothstep((u - 0.8) / 0.2);
    span = full * Math.pow(DEEP_SPAN, 1 - t);
    center = lerp(0.7, 0.5, t);
  }
  // Keep the window inside the data, as the zoom behavior would.
  const start = Math.min(Math.max(x0, x0 + center * full - span / 2), x1 - span);
  return [start, start + span];
}
