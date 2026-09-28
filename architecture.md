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

UI control → `data` client → the worker generates the columns **and** builds the per-station series
(`buildStationSeries`: in-service rows only, contiguous `x`/`y` per station; an O(N) pass, so it stays off the main
thread, P8) → every `ArrayBuffer` is **transferred** (zero-copy) → a store handle (marked non-reactive) →
`TimeSeriesChart.setData(series)` → gap-free lines → optional decimation of the visible slice (ADR 0006) →
`Renderer.setData()` (the GPU upload happens here) → `Renderer.render(viewport)` on each frame (only the uniforms or
projection change).

Rows whose status isn't "in service" are **left out**, not drawn as zero bikes. A closure therefore shows up as a gap
in the line, like a missing day (P9).

## Chart anatomy

Each chart is a framework-agnostic controller in `@bicing/charts` that owns this DOM inside a host element:

```
div.bp-chart
  div.bp-chart__plot       plot area; its inset (the axis margins) is defined in CSS
    <canvas|svg>.bp-chart__data   owned by the Renderer
  svg.bp-chart__axes       d3-axis, translated to the measured plot offset
  div.bp-chart__overlay    same box as the plot; carries d3-zoom (later d3-brush) and hover
```

- **CSS owns layout, JS measures it (P16).** `@bicing/charts/styles.css` (BEM class names, themed through CSS custom
  properties) positions the layers. The controller never writes inline styles. A `ResizeObserver` on the plot
  element reports its size, and a `matchMedia` listener catches devicePixelRatio changes (e.g. moving the window to
  another display).
- A per-chart `FrameScheduler` coalesces invalidations into one `requestAnimationFrame` and redraws only the dirty
  layers (`data`, `axes`, `overlay`).
- The x-axis uses `d3-scale`'s `scaleUtc` and is labeled UTC. Barcelona-local time is a Phase 2 concern.
- Text and formats come from a `ChartLocale` the app provides (a d3 time-format locale, a number formatter and the
  chart's few strings), and `setLocale()` swaps it and marks the axes and overlay dirty. The chart holds no copy of
  its own (see Language).
- Colors come from an interpolator the app provides per theme (a single-hue sequential ramp for "mean
  occupancy", following the dataviz method). The chart doesn't hardcode a palette.

## Rendering strategies

- **SVG baseline**: one `<path>` per line, `d` rebuilt every frame, no culling (a realistic D3 baseline). Capped at 1M
  points; beyond that it's reported as skipped.
- **Canvas 2D**: each line is culled to its visible range by binary search. Lines are grouped into 32 palette colors, with
  one `stroke()` per color. Drawn in CSS pixels under a dpr transform.
- **WebGL2**: vertex buffers are uploaded once, with integer attributes (`t` Uint32 via `vertexAttribIPointer`, 6
  bytes/point). The x-origin is split into an integer and a fraction, so the shader subtracts exactly before
  converting to float. Color comes from a 256×1 ramp texture built from a D3 interpolator. Each frame issues one
  `WEBGL_multi_draw` call over the culled lines. **No MSAA** (ADR 0009).
- All three implement one `Renderer` interface (ADR 0004). Benchmark results are in the README.

## Hover

Per-series binary search at the pointer's time (O(stations × log n), exact on full-resolution data, never inside a gap),
drawn in the SVG layer: crosshair, marker and tooltip (ADR 0008). Flatbush is reserved for the Phase 2 map.

## Downsampling

- **min/max per pixel column**: exact visual envelope, O(n) over the visible slice. The default mode when downsampling is on.
- **LTTB**: keeps the shape at a fixed point budget. Used where the point count matters more than the envelope.
- Both return **indices** into the source columns, recomputed on zoom over the visible slice only.
- Phase 2 adds precomputed multi-resolution aggregates (5 min / 1 h / 1 day), picked by the visible span.

## Framework boundary (Vue)

Vue owns layout, controls and the host elements. It never owns data:
controllers and store handles are `markRaw` and held in `shallowRef`. Data changes reach charts only through
imperative calls (`setData`, `setRenderer`, …), never through templates or reactive state.

## Language

The site is Catalan-first, with English as the second language (ADR 0011, P27). The repository's docs stay in English.

- `apps/web/src/i18n/`: `messages.ca.ts` is the source and defines the `Messages` type, and `messages.en.ts` must
  satisfy it. A `useI18n` composable exposes the active `locale` (a Vue setting) and its messages `t`.
- Resolution: `?lang=` → the remembered choice (localStorage, try/catch) → `ca`. The browser language is ignored.
- Formats: `Intl.NumberFormat(locale)` for numbers; `d3-time-format`'s `ca-ES` / `en-GB` locales for axes and tooltips.
- `index.html` is Catalan (`lang="ca"`, title, description) for crawlers and link previews. The app updates
  `<html lang>`, the title and the description when the language changes.
- Charts receive a `ChartLocale` through `setLocale()`. `@bicing/charts` never imports the app's dictionaries.

## Workers

Hand-written discriminated-union protocol (`data/protocol.ts`). Every response lists its buffers in
`transfer`. Requests carry an `id` so responses can be matched and stale ones dropped.

## Performance budgets

- Pan/zoom at 60 fps with 10M points on a mid-range laptop (WebGL).
- No main-thread task > 50 ms during brushing (Phase 3).
- Time-to-first-chart reported for 1 month and 1 year of data.

## Deployment

Public URL: `https://bicing.soms.cat` (host still to be chosen, tasks.md A9). Vite build → nginx (multi-stage Dockerfile). Headers: `Cross-Origin-Opener-Policy: same-origin`,
`Cross-Origin-Embedder-Policy: credentialless` (memory API, later SharedArrayBuffer). Parquet comes from a
configurable external base URL with CORS + range requests (Phase 2).

## Decision records

See `docs/adr/`. Any change to this file that has trade-offs gets an ADR.
