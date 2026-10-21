/**
 * Rows grouped by bin (ADR 0015): bin `b` is `rows[offsets[b]..offsets[b + 1])`, in row order. A
 * counting sort, O(n + bins), built once per load, so a brush that adds or drops a bin touches
 * exactly that bin's rows.
 */
export interface BinIndex {
  readonly offsets: Uint32Array;
  readonly rows: Uint32Array;
}

export function buildBinIndex(bins: ArrayLike<number>, binCount: number): BinIndex {
  const offsets = new Uint32Array(binCount + 1);
  for (let i = 0; i < bins.length; i++) {
    const b = bins[i] as number;
    if (b >= binCount)
      throw new RangeError(`bin ${String(b)} at row ${String(i)} is not below ${String(binCount)}`);
    offsets[b + 1] = (offsets[b + 1] as number) + 1;
  }
  for (let b = 0; b < binCount; b++)
    offsets[b + 1] = (offsets[b + 1] as number) + (offsets[b] as number);
  const rows = new Uint32Array(bins.length);
  const cursor = offsets.slice(0, binCount);
  for (let i = 0; i < bins.length; i++) {
    const b = bins[i] as number;
    rows[cursor[b] as number] = i;
    cursor[b] = (cursor[b] as number) + 1;
  }
  return { offsets, rows };
}
