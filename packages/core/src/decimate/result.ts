/**
 * Output of every decimator. `indices` point into the source columns (P4: no copies of values).
 * `segmentStarts` are positions *in indices* where a new gap-free line starts.
 *
 * Why the decimator returns segments instead of letting the renderer re-detect them: once
 * zoomed out, consecutive kept points can be further apart than maxGap without a real gap
 * between them.
 */
export interface Decimated {
  readonly indices: Uint32Array;
  readonly segmentStarts: Uint32Array;
}

/** Append-only Uint32 buffer that doubles as needed; decimation output size is only bounded loosely. */
export class IndexBuffer {
  private data: Uint32Array;
  length = 0;

  constructor(initialCapacity: number) {
    this.data = new Uint32Array(Math.max(4, initialCapacity));
  }

  push(value: number): void {
    if (this.length === this.data.length) {
      const grown = new Uint32Array(this.data.length * 2);
      grown.set(this.data);
      this.data = grown;
    }
    this.data[this.length++] = value;
  }

  /** A trimmed copy, so the oversized scratch buffer can be garbage-collected. */
  toArray(): Uint32Array {
    return this.data.slice(0, this.length);
  }
}
