import type { ChartFormat, ChartLocale } from './locale';

/**
 * Feed-wide silences (T2.6): no station published between `t0` and `t1` (minutes since the epoch).
 * Station lines already break there (P9); the shading and the tooltip say why.
 */
export interface GapPeriod {
  readonly t0: number;
  readonly t1: number;
  /** Why, when the app knows, e.g. the month was never published. */
  readonly note?: string;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
/** A 15-minute gap is far below a pixel over years; it still gets a hairline. */
const MIN_WIDTH_PX = 1;

/** Sorted by start, so lookups can binary-search. */
export function sortGaps(gaps: readonly GapPeriod[]): readonly GapPeriod[] {
  return [...gaps].filter((g) => g.t1 > g.t0).sort((a, b) => a.t0 - b.t0);
}

/** The gap whose interior holds `t`, or null. Its edges are real snapshots, so they're not inside. */
export function gapAt(gaps: readonly GapPeriod[], t: number): GapPeriod | null {
  // Last gap starting before t.
  let lo = 0;
  let hi = gaps.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((gaps[mid]?.t0 ?? Number.POSITIVE_INFINITY) < t) lo = mid + 1;
    else hi = mid;
  }
  const candidate = gaps[lo - 1];
  return candidate && t < candidate.t1 ? candidate : null;
}

/** One rect per gap that overlaps the visible domain, in plot coordinates. */
export function drawGaps(
  group: SVGGElement,
  gaps: readonly GapPeriod[],
  domain: readonly [number, number],
  width: number,
  height: number,
): void {
  const [d0, d1] = domain;
  const scale = width / (d1 - d0);
  const rects: SVGRectElement[] = [];
  for (const gap of gaps) {
    if (gap.t1 <= d0 || gap.t0 >= d1) continue;
    const x0 = (Math.max(gap.t0, d0) - d0) * scale;
    const x1 = (Math.min(gap.t1, d1) - d0) * scale;
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('class', 'bp-chart__gap');
    rect.setAttribute('x', String(x0));
    rect.setAttribute('y', '0');
    rect.setAttribute('width', String(Math.max(MIN_WIDTH_PX, x1 - x0)));
    rect.setAttribute('height', String(height));
    rects.push(rect);
  }
  group.replaceChildren(...rects);
}

/** The tooltip for a gap: no data, from when to when, how long, and why if known. */
export function gapLines(gap: GapPeriod, format: ChartFormat, locale: ChartLocale): string[] {
  const lines = [
    locale.noData,
    `${format.time(gap.t0)} →`,
    format.time(gap.t1),
    locale.duration(gap.t1 - gap.t0),
  ];
  return gap.note === undefined ? lines : [...lines, gap.note];
}
