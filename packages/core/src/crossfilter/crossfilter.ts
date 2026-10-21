import { buildBinIndex, type BinIndex } from './bin-index';

/** A dimension whose rows fall into bins: hour of day, occupancy, station (ADR 0015). */
export interface BinnedDimension {
  /** The bin of each row. */
  readonly bins: Uint8Array | Uint16Array;
  readonly binCount: number;
}

export interface CrossfilterInput {
  /** Up to 7 binned dimensions; bit 0 of the mask is the time range, bit d + 1 dimension d. */
  readonly dimensions: readonly BinnedDimension[];
  /** What `groupCounts` counts by, e.g. the station of each row. */
  readonly group: BinnedDimension;
}

/**
 * The crossfilter of ADR 0015, pure and incremental. Each row has a mask with one bit per dimension
 * that filters it out; a row passes when its mask is 0. Changing a filter toggles only the rows
 * whose membership changed, and the counts move by delta, so a brush drag costs what it changes,
 * not the whole dataset.
 *
 * - `histogram(d)`: rows per bin of dimension d that pass every filter except d's own, so a
 *   histogram still shows where its own brush could go.
 * - `groupCounts()`: rows per group that pass every filter.
 *
 * Rows are in time order, so the time filter is a row range [r0, r1).
 */
export class Crossfilter {
  readonly rows: number;
  // The hot loop in `toggle` reads these per row: plain arrays, looked up once (P6).
  private readonly binsOf: (Uint8Array | Uint16Array)[];
  private readonly othersOf: number[];
  private readonly indexes: readonly BinIndex[];
  private readonly group: Uint8Array | Uint16Array;
  private readonly mask: Uint8Array;
  private readonly passes: Uint8Array[];
  private readonly histograms: Uint32Array[];
  private readonly groups: Uint32Array;
  private passingRows: number;
  private r0 = 0;
  private r1: number;

  constructor(input: CrossfilterInput) {
    if (input.dimensions.length > 7) throw new RangeError('at most 7 binned dimensions');
    this.rows = input.group.bins.length;
    for (const dimension of input.dimensions)
      if (dimension.bins.length !== this.rows)
        throw new RangeError('every dimension needs a bin per row');
    this.binsOf = input.dimensions.map((d) => d.bins);
    // A histogram counts a row when every bit except its own is clear.
    this.othersOf = input.dimensions.map((_, d) => ~(1 << (d + 1)));
    this.indexes = input.dimensions.map((d) => buildBinIndex(d.bins, d.binCount));
    this.group = input.group.bins;
    this.mask = new Uint8Array(this.rows);
    this.passes = input.dimensions.map((d) => new Uint8Array(d.binCount).fill(1));
    // Nothing is filtered yet: every row counts everywhere.
    this.histograms = this.indexes.map((index) => {
      const counts = new Uint32Array(index.offsets.length - 1);
      for (let b = 0; b < counts.length; b++)
        counts[b] = (index.offsets[b + 1] as number) - (index.offsets[b] as number);
      return counts;
    });
    this.groups = new Uint32Array(input.group.binCount);
    for (let i = 0; i < this.rows; i++) {
      const g = this.group[i] as number;
      this.groups[g] = (this.groups[g] as number) + 1;
    }
    this.passingRows = this.rows;
    this.r1 = this.rows;
  }

  /** Dimension `d` keeps the bins for which `keep` is true. Only bins that changed are touched. */
  filterBins(d: number, keep: (bin: number) => boolean): void {
    const passes = this.passes[d];
    const index = this.indexes[d];
    if (!passes || !index) throw new RangeError(`no dimension ${String(d)}`);
    const bit = 1 << (d + 1);
    for (let b = 0; b < passes.length; b++) {
      const now = keep(b);
      if ((passes[b] === 1) === now) continue;
      passes[b] = now ? 1 : 0;
      const end = index.offsets[b + 1] as number;
      for (let k = index.offsets[b] as number; k < end; k++)
        this.toggle(index.rows[k] as number, bit, !now);
    }
  }

  /** Dimension `d` keeps bins [lo, hi): a brush on a histogram. */
  filterRange(d: number, lo: number, hi: number): void {
    this.filterBins(d, (b) => b >= lo && b < hi);
  }

  clear(d: number): void {
    this.filterBins(d, () => true);
  }

  /** Time keeps rows [r0, r1). Rows are sorted by time, so only the two end runs change. */
  filterRows(r0: number, r1: number): void {
    const lo = Math.max(0, Math.min(r0, this.rows));
    const hi = Math.max(lo, Math.min(r1, this.rows));
    const run = (a: number, b: number) => {
      for (let i = Math.min(a, b); i < Math.max(a, b); i++) this.toggle(i, 1, i < lo || i >= hi);
    };
    run(this.r0, lo);
    run(this.r1, hi);
    this.r0 = lo;
    this.r1 = hi;
  }

  /** Live counts, updated in place: copy before handing them to another thread. */
  histogram(d: number): Uint32Array {
    const counts = this.histograms[d];
    if (!counts) throw new RangeError(`no dimension ${String(d)}`);
    return counts;
  }

  groupCounts(): Uint32Array {
    return this.groups;
  }

  passing(): number {
    return this.passingRows;
  }

  private toggle(i: number, bit: number, filtered: boolean): void {
    const before = this.mask[i] as number;
    const after = filtered ? before | bit : before & ~bit;
    if (before === after) return;
    this.mask[i] = after;
    // A histogram ignores its own dimension's bit (crossfilter semantics).
    const { binsOf, othersOf, histograms } = this;
    for (let d = 0; d < binsOf.length; d++) {
      const others = othersOf[d] as number;
      const was = (before & others) === 0;
      if (was === ((after & others) === 0)) continue;
      const counts = histograms[d] as Uint32Array;
      const b = (binsOf[d] as Uint8Array | Uint16Array)[i] as number;
      counts[b] = (counts[b] as number) + (was ? -1 : 1);
    }
    if ((before === 0) !== (after === 0)) {
      const g = this.group[i] as number;
      const delta = after === 0 ? 1 : -1;
      this.groups[g] = (this.groups[g] as number) + delta;
      this.passingRows += delta;
    }
  }
}
