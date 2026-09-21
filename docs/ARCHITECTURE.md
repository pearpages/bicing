# Bicing Pulse — Architecture

## Purpose

An interactive explorer of Barcelona's Bicing station-status history, built to show how to render
millions of data points smoothly in the browser. D3 computes (scales, axes, ticks, zoom, brush,
color); Canvas 2D / WebGL2 draw the data marks; SVG is used only for axes and overlays, and as the naive baseline renderer.

## Packages and dependency graph

| Package             | Role                                                                                                         | May depend on   |
| ------------------- | ------------------------------------------------------------------------------------------------------------ | --------------- |
| `@bicing/core`      | Types, columnar store, pure algorithms (search, decimation, later bitsets/aggregates). No DOM, no framework. | —               |
| `@bicing/synthetic` | Seeded generator that produces the real schema at any size. Pure.                                            | core            |
| `@bicing/data`      | Worker entry points and the typed message protocol; Parquet/Arrow decoding (Phase 2).                        | core, synthetic |
| `@bicing/renderers` | The `Renderer` interface + `SvgRenderer`, `CanvasRenderer`, `WebGLRenderer`.                                 | core            |
| `@bicing/charts`    | Framework-agnostic controllers: D3 scales/axes/zoom/brush, layers, scheduler, picking.                       | core, renderers |
| `@bicing/vue`       | Thin Vue 3 bindings (composables + components) over the charts.                                              | core, charts    |
| `apps/web`          | Demo app: layout, controls, benchmark mode.                                                                  | anything        |
| `tools/*`           | Node CLIs (prepare-data, synthetic).                                                                         | packages only   |

Nothing depends on `apps/*` or `tools/*`. Enforced by `eslint-plugin-boundaries` and by pnpm's strict
dependency isolation.

## Data model

Columnar, typed arrays only; no arrays of objects on any hot path.

- **Stations** (~500, loaded once): `ids`, `names`, `lat`/`lon` (Float32), `capacity` (Uint8). Original IDs map to a dense `0..N-1`.
- **Observations**: `stationIdx` Uint16, `t` Uint32 (minutes since 2018-01-01T00:00Z), `bikesMech`,
  `bikesElec`, `docks`, `status` Uint8. Sorted by (`t`, `stationIdx`), so a time range is a contiguous slice
  found by binary search.
- Per-station series are a permutation index (Uint32, sorted by station then t) plus `offsets`. The column data is never copied for it.
- Gaps: consecutive samples further apart than `maxGap` start a new segment. Lines never bridge a gap.

## Data flow (Phase 1)

UI control → `data` client → worker generates the columns → the `ArrayBuffer`s are **transferred** (zero-copy) → a
store handle (marked non-reactive) → `TimeSeriesChart.setData()` → decimation over the visible slice → `Renderer.setData()`
(the GPU upload happens once) → `Renderer.render(viewport)` on each frame (only the uniforms change).

## Chart anatomy

Each chart stacks three layers in a single positioned container:

1. **Data layer**: `<canvas>` (Canvas/WebGL) or `<svg>` (baseline). Owned by a `Renderer`.
2. **Axes layer**: `<svg>`, drawn with d3-axis.
3. **Interaction overlay**: a transparent element that carries d3-zoom / d3-brush and hover.
   A per-chart `FrameScheduler` coalesces requests into one `requestAnimationFrame` and redraws only the dirty layers.
   Canvas backing stores are sized `cssSize × devicePixelRatio`. A ResizeObserver drives the resize.

## Rendering strategies

- **SVG baseline**: one `<path>` per series. Capped at 1M points, beyond that it's reported as skipped.
- **Canvas 2D**: one path per series, drawn through the current transform. Decimated input.
- **WebGL2**: vertex buffers are uploaded once, with integer attributes (`t` Uint32 via `vertexAttribIPointer`).
  The x-origin is subtracted in the shader to keep float32 precision. Color comes from a 256×1 ramp texture
  built from a D3 color interpolator.

## Downsampling

- **min/max per pixel column**: exact visual envelope, O(n) over the visible slice. The default for lines.
- **LTTB**: keeps the shape at a fixed point budget. Used where the point count matters more than the envelope.
- Both return **indices** into the source columns, recomputed on zoom over the visible slice only.
- Phase 2 adds precomputed multi-resolution aggregates (5 min / 1 h / 1 day), picked by the visible span.

## Framework boundary (Vue)

Vue owns layout, controls and the host elements. It never owns data:
controllers and store handles are `markRaw` and held in `shallowRef`. Data changes reach charts only through
imperative calls (`setData`, `setRenderer`, …), never through templates or reactive state.

## Workers

Hand-written discriminated-union protocol (`data/protocol.ts`). Every response lists its buffers in
`transfer`. Requests carry an `id` so responses can be matched and stale ones dropped.

## Performance budgets

- Pan/zoom at 60 fps with 10M points on a mid-range laptop (WebGL).
- No main-thread task > 50 ms during brushing (Phase 3).
- Time-to-first-chart reported for 1 month and 1 year of data.

## Deployment

Vite build → nginx (multi-stage Dockerfile). Headers: `Cross-Origin-Opener-Policy: same-origin`,
`Cross-Origin-Embedder-Policy: credentialless` (memory API, later SharedArrayBuffer). Parquet comes from a
configurable external base URL with CORS + range requests (Phase 2).

## Decision records

See `docs/adr/`. Any change to this file that has trade-offs gets an ADR.
