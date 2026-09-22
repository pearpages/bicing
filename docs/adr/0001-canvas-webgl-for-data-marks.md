# 0001 — Canvas 2D / WebGL2 for data marks, not SVG

- **Status:** Accepted
- **Date:** 2026-09-21
- **Principles:** P1, P3, P5, P6

## Context

The project must render up to tens of millions of observations interactively (pan, zoom, brush
at 60 fps). The idiomatic D3 approach binds each datum to an SVG element (`selection.data().join()`).
That approach costs per mark:

- one DOM node per mark (or one very long `d` attribute string per series), each with its own
  memory, style resolution and layout work;
- string serialization of every coordinate on every update, then parsing by the browser;
- a repaint of the whole subtree on every transform change.

In practice SVG stays fluid up to the low tens of thousands of marks, and hundreds of thousands of
points in a few paths. Beyond that, each frame is dominated by DOM and string work, not by the
drawing itself.

## Decision

**D3 does the math, not the DOM, for large data.**

- D3 modules (`d3-scale`, `d3-axis`, `d3-zoom`, `d3-brush`, `d3-scale-chromatic`, `d3-time-format`,
  `d3-array`) compute scales, ticks, transforms and colors.
- Data marks are drawn by a `Renderer`: **Canvas 2D** for moderate sizes and simplicity, **WebGL2**
  for millions of points (buffers uploaded once; per frame, only uniforms change).
- SVG is used for axes, overlays, and as the deliberately naive baseline renderer in benchmark
  mode, which shows the crossover point with measured numbers instead of asserting it.

## Consequences

- Positive: frame cost depends on pixels and draw calls, not on DOM size. WebGL moves the
  per-point transform to the GPU.
- Positive: SVG, Canvas and WebGL share one interface, so the benchmark compares them fairly
  on the same data and interactions.
- Negative: no free DOM events per mark. Hover and picking need a spatial index (flatbush),
  and accessibility needs a separate, summarized representation.
- Negative: WebGL adds shader code, context-loss handling and GPU memory limits.
- Negative: text and crisp lines are harder on canvas. That's why axes stay in SVG.

## Alternatives considered

- **SVG everywhere, with decimation.** Decimation alone keeps SVG usable for static views, but
  every zoom re-serializes paths and the DOM stays the bottleneck. Kept as the baseline.
- **A charting library (ECharts, Plotly, deck.gl).** Would hide the techniques the project exists to
  demonstrate (P1, P2).
- **WebGPU.** Better compute story, but support and tooling are still uneven across target browsers.
  WebGL2 is universal. Could be revisited behind the same `Renderer` interface.
