import type { Domain } from './historyView';

/** Playing the whole loaded range takes about this long, whatever its span. */
export const PLAY_MS = 30_000;

/** The scrubber's step: the feed reports every 5 minutes. */
export const SCRUB_STEP = 5;

/**
 * Where playback is after `elapsedMs` of wall time. Driven by the frame clock, not frame count, so
 * a slow frame jumps further instead of slowing playback down (T3.5).
 */
export function playStep(
  t: number,
  elapsedMs: number,
  extent: Domain,
): { t: number; done: boolean } {
  const [t0, t1] = extent;
  const next = t + Math.max(0, elapsedMs) * ((t1 - t0) / PLAY_MS);
  return next >= t1 ? { t: t1, done: true } : { t: next, done: false };
}
