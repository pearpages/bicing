# 0004 — One Renderer interface; expensive work in setData, cheap work in render

- **Status:** Accepted
- **Date:** 2026-09-22
- **Principles:** P3, P5, P6, P9, P12

## Context

The benchmark has to compare SVG, Canvas 2D and WebGL2 **on identical data and interactions**.
Otherwise the numbers compare implementations, not technologies. The chart controller owns the D3
math (scales, zoom, axes) and shouldn't know how marks are drawn. Each technology has a
different split between one-off and per-frame cost: DOM creation, GPU upload, path construction.

## Decision

`@bicing/renderers` defines one interface:

```ts
interface Renderer {
  kind: 'svg' | 'canvas' | 'webgl';
  element: HTMLCanvasElement | SVGSVGElement;
  maxPoints: number; // beyond this, the chart reports "skipped"
  setData(data: LineSeriesData): void; // expensive, once per dataset: DOM nodes, GPU buffers, color groups
  setColorScale(interpolate): void; // (t: number) => CSS color, e.g. d3.interpolateViridis
  resize(width, height, dpr): void; // CSS px + devicePixelRatio
  render(view: Viewport): RenderStats; // per frame: domains → pixels, returns points and draw calls
  destroy(): void;
}
```

`LineSeriesData` is packed polylines: `x` (Uint32 minutes), `y`, `lineStarts` (one line per
gap-free run, so gaps are never bridged, P9) and `lineValue` (0–1 per line → color).

- **Projection** is an affine transform derived from the viewport's domains, matching
  `d3.scaleLinear`. Renderers get domains, not D3 scale objects: they stay D3-free, and WebGL needs
  just the coefficients as uniforms.
- **SVG** is the naive baseline: one `<path>` per line, `d` rebuilt for every point on every frame,
  no culling. That's what `selection.attr('d', line)` does. Capped at 1M points.
- **Canvas 2D** culls each line to its visible range by binary search and groups lines into 32
  quantized colors: **one `stroke()` per color, not per line**. Drawing is in CSS pixels under a
  `dpr` transform.
- **WebGL2** (T1.8) uploads the buffers in `setData`, and `render` only sets uniforms (P6).

## Consequences

- Positive: any renderer can be swapped at runtime on the same data, which is what the benchmark needs.
  `RenderStats` makes the per-frame work visible in the overlay.
- Positive: the pure parts (projection, dpr sizing, palette grouping, culling) are unit-tested in
  Node. The Canvas renderer is tested against a recording fake context.
- Negative: colors are quantized to 32 steps on Canvas (visually continuous for a sequential scale).
  SVG uses exact colors.
- Negative: the renderer, not the chart, decides its point cap. The chart must check `maxPoints`
  before calling `setData`.

## Alternatives considered

- **Hand D3 scales to renderers.** Couples every renderer to D3, and WebGL would have to extract the
  coefficients anyway.
- **One stroke per line on Canvas.** Simpler, but 500+ stroke calls per frame dominate at small
  point counts. The benchmark can show the difference.
- **Culling in the SVG baseline.** It would make SVG look better than typical D3 code. The
  baseline's job is to be realistic.
