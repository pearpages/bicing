/**
 * Quantizes a continuous color scale into `size` buckets. Canvas 2D pays per stroke() call, so lines
 * are grouped by bucket and drawn with one stroke per color instead of one per line. 32 steps
 * are visually continuous for a sequential scale.
 */
export const PALETTE_SIZE = 32;

export function samplePalette(interpolate: (t: number) => string, size = PALETTE_SIZE): string[] {
  if (size === 1) return [interpolate(0.5)];
  return Array.from({ length: size }, (_, i) => interpolate(i / (size - 1)));
}

export function paletteBucket(value: number, size = PALETTE_SIZE): number {
  const clamped = value < 0 || Number.isNaN(value) ? 0 : value > 1 ? 1 : value;
  return Math.min(size - 1, Math.round(clamped * (size - 1)));
}

/** Line ids grouped by palette bucket: groups[b] lists the lines drawn with palette color b. */
export function groupLinesByBucket(lineValue: Float32Array, size = PALETTE_SIZE): Uint32Array[] {
  const counts = new Uint32Array(size);
  const buckets = new Uint8Array(lineValue.length);
  for (let k = 0; k < lineValue.length; k++) {
    const b = paletteBucket(lineValue[k] as number, size);
    buckets[k] = b;
    counts[b] = (counts[b] as number) + 1;
  }
  const groups = Array.from(counts, (c) => new Uint32Array(c));
  const fill = new Uint32Array(size);
  for (let k = 0; k < lineValue.length; k++) {
    const b = buckets[k] as number;
    const group = groups[b] as Uint32Array;
    group[fill[b] as number] = k;
    fill[b] = (fill[b] as number) + 1;
  }
  return groups;
}
