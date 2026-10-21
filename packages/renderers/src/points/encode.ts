/** Added to a dimmed point's value: the shader sees anything above 2 as dimmed and takes it off. */
export const DIM_OFFSET = 4;

/**
 * Per-point values for the shader: fill in [0, 1], or -1 for "no data" (NaN), which the fragment
 * shader paints with its own color instead of a fake "empty" from the ramp (P9). A dimmed point
 * (filtered out, ADR 0015) is shifted by DIM_OFFSET, so one float still carries all three.
 */
export function encodeValues(
  values: ArrayLike<number>,
  dimmed: ArrayLike<number> | null = null,
  out = new Float32Array(values.length),
) {
  for (let i = 0; i < values.length; i++) {
    const v = values[i] as number;
    const encoded = Number.isNaN(v) ? -1 : Math.min(1, Math.max(0, v));
    out[i] = dimmed?.[i] === 1 ? encoded + DIM_OFFSET : encoded;
  }
  return out;
}
