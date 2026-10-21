/**
 * Per-point values for the shader: fill in [0, 1], or -1 for "no data" (NaN), which the fragment
 * shader paints with its own color instead of a fake "empty" from the ramp (P9).
 */
export function encodeValues(values: ArrayLike<number>, out = new Float32Array(values.length)) {
  for (let i = 0; i < values.length; i++) {
    const v = values[i] as number;
    out[i] = Number.isNaN(v) ? -1 : Math.min(1, Math.max(0, v));
  }
  return out;
}
