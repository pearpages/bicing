/**
 * Color scale → 256×1 RGBA texture. The fragment shader looks colors up by a 0–1 value, so a D3
 * interpolator (e.g. interpolateViridis) is sampled once on the CPU instead of being
 * reimplemented in GLSL.
 */
export const RAMP_SIZE = 256;

/** Parses the color formats d3 interpolators emit: "rgb(r, g, b)", "rgba(r, g, b, a)" and "#rrggbb". */
export function parseColor(css: string): [number, number, number, number] {
  const s = css.trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(s);
  if (hex?.[1]) {
    const n = Number.parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
  }
  const fn = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s);
  if (fn) {
    const channel = (v: string | undefined) => Math.max(0, Math.min(255, Math.round(Number(v))));
    const alpha =
      fn[4] === undefined ? 255 : Math.round(Math.max(0, Math.min(1, Number(fn[4]))) * 255);
    return [channel(fn[1]), channel(fn[2]), channel(fn[3]), alpha];
  }
  throw new Error(`Unsupported color "${css}" (expected rgb(), rgba() or #rrggbb)`);
}

export function rampBytes(interpolate: (t: number) => string, size = RAMP_SIZE): Uint8Array {
  const bytes = new Uint8Array(size * 4);
  for (let i = 0; i < size; i++) {
    bytes.set(parseColor(interpolate(size === 1 ? 0.5 : i / (size - 1))), i * 4);
  }
  return bytes;
}
