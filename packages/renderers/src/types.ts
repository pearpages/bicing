/**
 * Packed polylines: line k covers points [lineStarts[k], lineStarts[k + 1]). One line per gap-free
 * run of one series, so gaps are never drawn across (P9). Values are in data space (x = minutes),
 * and renderers project them.
 */
export interface LineSeriesData {
  readonly x: Uint32Array;
  readonly y: Uint8Array | Uint16Array | Float32Array;
  /** Length = line count + 1. */
  readonly lineStarts: Uint32Array;
  /** One value in [0, 1] per line, mapped through the color scale. */
  readonly lineValue: Float32Array;
  /** The station each line belongs to, so a station-level selection can dim its lines (ADR 0015). */
  readonly lineStation?: Uint16Array;
}

/** A dimmed line keeps this share of the renderer's alpha: present, but behind the selection. */
export const DIM_ALPHA = 0.12;

/** The plot area in CSS pixels, plus the visible data domain. */
export interface Viewport {
  readonly xDomain: readonly [number, number];
  readonly yDomain: readonly [number, number];
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
}

export interface RenderStats {
  /** Points actually submitted this frame (after culling). */
  readonly points: number;
  /** Stroke/draw calls issued; the dominant per-frame cost for Canvas and SVG. */
  readonly drawCalls: number;
}

export type RendererKind = 'svg' | 'canvas' | 'webgl';

/**
 * The seam between the D3-driven chart controller (the math) and the drawing technology (ADR 0004).
 * setData is the expensive call (DOM creation, GPU upload). render is called once per frame
 * and must do only per-frame work (P6).
 */
export interface Renderer {
  readonly kind: RendererKind;
  readonly element: HTMLCanvasElement | SVGSVGElement;
  /** Largest point count this renderer accepts in setData. Beyond it, the chart reports "skipped". */
  readonly maxPoints: number;
  setData(data: LineSeriesData): void;
  /** `interpolate` maps [0, 1] to a CSS color, e.g. a d3-scale-chromatic interpolator. */
  setColorScale(interpolate: (t: number) => string): void;
  /**
   * One flag per line of the current data, 1 = dimmed (filtered out, ADR 0015); null dims nothing.
   * Only how lines are drawn changes: nothing is uploaded again (P6).
   */
  setDimmed(lines: Uint8Array | null): void;
  resize(width: number, height: number, dpr: number): void;
  render(view: Viewport): RenderStats;
  destroy(): void;
}

export const EMPTY_LINES: LineSeriesData = {
  x: new Uint32Array(0),
  y: new Uint8Array(0),
  lineStarts: Uint32Array.of(0),
  lineValue: new Float32Array(0),
};
