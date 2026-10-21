import type { Level } from '@bicing/data';
import { MINUTES_PER_DAY } from '@bicing/core';

/**
 * Which level of the whole history a view needs (T2.5b, ADR 0014), as pure functions so the
 * policy is tested on its own. Each level keeps a loaded window under about 5M points.
 */

/** Up to a week of raw readings (~560 stations × 288 a day × 3 weeks loaded ≈ 3.4M). */
export const RAW_MAX_SPAN = 7 * MINUTES_PER_DAY;
/** Up to 60 days of hourly buckets (~560 × 24 × 180 days loaded × 2 points ≈ 4.8M). */
export const HOUR_MAX_SPAN = 60 * MINUTES_PER_DAY;

export type Domain = readonly [number, number];

export function pickLevel(span: number): Level {
  if (span <= RAW_MAX_SPAN) return 'raw';
  if (span <= HOUR_MAX_SPAN) return '1h';
  return '1d';
}

/**
 * The window to load for a view: the view plus one span on each side, so a small pan doesn't
 * refetch, clamped to the coverage. The daily level is small enough (8 MB) to load whole.
 */
export function windowFor(level: Level, view: Domain, extent: Domain): Domain {
  if (level === '1d') return extent;
  const span = view[1] - view[0];
  return [Math.max(extent[0], view[0] - span), Math.min(extent[1], view[1] + span)];
}

/** A new request is needed when the level changes or the view leaves the loaded window. */
export function needsReload(
  loaded: { readonly level: Level; readonly window: Domain },
  view: Domain,
): boolean {
  return (
    pickLevel(view[1] - view[0]) !== loaded.level ||
    view[0] < loaded.window[0] ||
    view[1] > loaded.window[1]
  );
}
