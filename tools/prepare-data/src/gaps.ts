import { MINUTES_PER_DAY, toEpochMs, toMinutes } from '@bicing/core';

/**
 * Where the feed went silent, found from the snapshots themselves (T2.3: detected, not assumed). A
 * gap is a stretch longer than the threshold with no snapshot from any station, the same rule that
 * breaks a station's line (`DEFAULT_MAX_GAP_MINUTES`), so shading and line breaks agree.
 */

export interface GapPeriod {
  /** The last snapshot before the silence, or the start of coverage (minutes since the epoch). */
  readonly t0: number;
  /** The first snapshot after it, or the end of coverage. */
  readonly t1: number;
}

export interface GapReport {
  readonly thresholdMinutes: number;
  readonly coverage: {
    readonly t0: number;
    readonly t1: number;
    readonly from: string;
    readonly to: string;
  };
  readonly gaps: readonly (GapPeriod & {
    readonly from: string;
    readonly to: string;
    readonly minutes: number;
  })[];
  /** Months inside coverage that the catalogue has no archive for. */
  readonly missingMonths: readonly string[];
  /** UTC days inside coverage with no snapshot at all. */
  readonly missingDays: readonly string[];
  /** Months the catalogue has an archive for, but the wrong one (ADR 0012), with the reason. */
  readonly unusableMonths: readonly { readonly month: string; readonly reason: string }[];
}

/**
 * `snapshots` must be sorted ascending and inside [t0, t1). The coverage edges count as boundaries:
 * a month that starts late or ends early leaves a gap against them.
 */
export function findGaps(
  snapshots: Iterable<number>,
  t0: number,
  t1: number,
  threshold: number,
): GapPeriod[] {
  const gaps: GapPeriod[] = [];
  let previous = t0;
  for (const t of snapshots) {
    if (t - previous > threshold) gaps.push({ t0: previous, t1: t });
    previous = t;
  }
  if (t1 - previous > threshold) gaps.push({ t0: previous, t1 });
  return gaps;
}

/** `YYYY-MM-DD` of each UTC day in [t0, t1) that holds no snapshot. */
export function missingDays(snapshots: Iterable<number>, t0: number, t1: number): string[] {
  const seen = new Set<number>();
  for (const t of snapshots) seen.add(Math.floor(t / MINUTES_PER_DAY));
  const days: string[] = [];
  for (let day = Math.floor(t0 / MINUTES_PER_DAY); day * MINUTES_PER_DAY < t1; day++)
    if (!seen.has(day)) days.push(isoDay(day * MINUTES_PER_DAY));
  return days;
}

/** Every `YYYY-MM` from `first` to `last` inclusive. */
export function monthsBetween(first: string, last: string): string[] {
  const months: string[] = [];
  let [year, month] = first.split('-').map(Number) as [number, number];
  const [lastYear, lastMonth] = last.split('-').map(Number) as [number, number];
  while (year < lastYear || (year === lastYear && month <= lastMonth)) {
    months.push(`${String(year)}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) [year, month] = [year + 1, 1];
  }
  return months;
}

/** Minutes since the epoch at the start of a UTC month (`YYYY-MM`), or of the month after it. */
export function monthStart(month: string, offset = 0): number {
  const [year, index] = month.split('-').map(Number) as [number, number];
  return toMinutes(Date.UTC(year, index - 1 + offset, 1));
}

const iso = (t: number) => new Date(toEpochMs(t)).toISOString();
const isoDay = (t: number) => iso(t).slice(0, 10);

export function gapReport(
  snapshots: Iterable<number>,
  catalogue: readonly string[],
  threshold: number,
  unusable: GapReport['unusableMonths'] = [],
): GapReport {
  const sorted = [...catalogue].sort();
  const first = sorted[0];
  const last = sorted.at(-1);
  if (first === undefined || last === undefined) throw new Error('no months to report gaps for');
  const t0 = monthStart(first);
  const t1 = monthStart(last, 1);
  const listed = new Set(sorted);
  return {
    thresholdMinutes: threshold,
    coverage: { t0, t1, from: iso(t0), to: iso(t1) },
    gaps: findGaps(snapshots, t0, t1, threshold).map((gap) => ({
      ...gap,
      from: iso(gap.t0),
      to: iso(gap.t1),
      minutes: gap.t1 - gap.t0,
    })),
    missingMonths: monthsBetween(first, last).filter((month) => !listed.has(month)),
    missingDays: missingDays(snapshots, t0, t1),
    unusableMonths: unusable,
  };
}
