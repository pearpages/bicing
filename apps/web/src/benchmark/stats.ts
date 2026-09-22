/** Percentile by nearest rank on a copy (the input stays in time order for the trace). */
export function percentile(values: ArrayLike<number>, p: number): number {
  if (values.length === 0) return 0;
  const sorted = Float64Array.from(values).sort();
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank] ?? 0;
}

/** Fixed-size ring of recent samples, read back oldest → newest. */
export class Ring {
  private readonly data: Float64Array;
  private next = 0;
  private count = 0;

  constructor(readonly capacity: number) {
    this.data = new Float64Array(capacity);
  }

  push(value: number): void {
    this.data[this.next] = value;
    this.next = (this.next + 1) % this.capacity;
    this.count = Math.min(this.count + 1, this.capacity);
  }

  clear(): void {
    this.next = 0;
    this.count = 0;
  }

  get size(): number {
    return this.count;
  }

  toArray(): Float64Array {
    const out = new Float64Array(this.count);
    const start = (this.next - this.count + this.capacity) % this.capacity;
    for (let i = 0; i < this.count; i++) out[i] = this.data[(start + i) % this.capacity] ?? 0;
    return out;
  }
}
