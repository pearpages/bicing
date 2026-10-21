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

## Ingest (Phase 2, `tools/prepare-data`)

`pnpm prepare-data` → CKAN `package_show` finds the monthly 7z archives → idempotent cache in `data/raw/<dataset>/<YYYY-MM>.7z`
(T2.1) → per month: 7z-wasm extracts the one CSV into a scratch folder under `data/` → DuckDB selects columns by name,
`TRY_CAST`s, drops and counts invalid rows, takes the time from `last_reported` floored to the minute, keeps one row per
(station, minute), and joins the month's latest station information, checking capacity against the readings (T2.2,
ADR 0012). `--read-month` reads that into `ObservationColumns` + `StationTable` with dense indices in id order.

`pnpm prepare-data --build` writes the files the app loads (T2.3), in two steps:

1. **Stage** each month into `data/stage/<YYYY-MM>/`: `obs.parquet` (original `station_id`, `t` and the readings),
   `stations.parquet`, `snapshots.parquet` (the minute of every feed snapshot) and `report.json`. A month is
   re-staged only when its archives change (their cache entries are recorded in `report.json`).
2. **Publish** into `data/parquet/`:
   - `stations.json`: one station table for every month. A station's row comes from the latest month it appears
     in, and indices `0..N-1` follow ascending id, so a file's `stationIdx` means the same thing in every file.
   - `observations-<YYYY-MM>.parquet`: the rows whose `t` falls in that UTC month, sorted by (`t`, `stationIdx`).
     The archives are cut by Barcelona local time (September's starts at 22:00 UTC on 31 August), so a month is
     built from its staged neighbours too, deduplicated per (station, `t`).
   - `observations.parquet`: every month concatenated in order, so it's sorted without a global sort.
   - `gaps.json`: periods where the whole feed published no snapshot for more than `DEFAULT_MAX_GAP_MINUTES` (15),
     the same threshold at which lines already break, plus the months the catalogue has no archive for and the UTC
     days with no snapshot at all. Coverage runs from the first catalogued month to the end of the last one, so
     a month that starts late or ends early shows up as a gap too. Detected from the data, never assumed.
     `unusableMonths` lists months whose status archive holds the wrong file (ADR 0012), with the reason.
   - `agg-1d.parquet` and `agg-1h-<YYYY>.parquet` (T2.5a, ADR 0014): per station and UTC bucket, over in-service
     readings, the `min`, `max` and `mean` bikes and the `count` of readings, sorted by (`t`, `stationIdx`). They're
     built from the monthly files in the same step, so they can't drift from them.
   - `manifest.json`: each file with its level (`raw`, `1h`, `1d`), rows, bytes and time range, for the browser
     loader (T2.4).

   Parquet columns keep the compact types (`stationIdx` UINT16, `t` UINT32, the rest UINT8), Snappy-compressed so
   that every reader T2.4 compares can decode them.

## Data flow (Phase 2, real data)

Data source control → `data` client `load({ baseUrl, months })` → the worker fetches `stations.json` and each
`observations-<YYYY-MM>.parquet` from `VITE_DATA_BASE_URL` (default `/data/`) → parquet-wasm decodes each file
into typed columns (the WASM is initialised on the first load only) → the columns are validated and the months
concatenated into one `ObservationColumns` → `buildStationSeries` → every buffer is transferred, exactly as for
synthetic data (ADR 0005, ADR 0013). The chart can't tell the two sources apart. In development and `vite
preview`, a Vite plugin serves `data/parquet` at `/data/` with range support; in production the files live on an
external host with CORS.

### Whole history: the level follows the view (T2.5b, ADR 0014)

"Tot l'historial" opens on the 1-day level for the whole coverage. When the visible span settles (200 ms after the
last zoom or pan), the app picks the level the span needs and asks the worker for a window of it:

- **Level:** raw readings up to a 7-day span, 1 hour up to 60 days, 1 day beyond. Each keeps a loaded window under
  about 5M points.
- **Window:** the visible range plus one span on each side, clamped to the coverage, so a small pan doesn't refetch.
  A new request is made only when the level changes or the view leaves the window.
- **Worker:** a `view` request (`level`, `window`) finds the files from `manifest.json` (names checked against the
  three patterns T2.3 writes). It decodes them, keeping the last 4 decoded files for zooming back and forth, slices
  each to the window by binary search on `t`, and builds the series: `buildStationSeries` for raw data, and
  `buildAggregateSeries` (core) for buckets, as min/max pairs with a one-bucket gap threshold. Every buffer is
  transferred.
- **Chart:** `setData(series, { extent, keepView })` replaces the lines without touching the zoom. The extent is
  the whole coverage, not the loaded data, so the zoom limits stay the same at every level.

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
- **Gaps (T2.6):** `setGaps(periods)` takes the feed-wide silences from `gaps.json`, each with an optional note
  from the app (e.g. "Open Data BCN didn't publish November 2025"). They're shaded in the axes layer, under the grid,
  at least 1 px wide so long zooms still show them. When the pointer's time falls inside one, the tooltip says there
  is no data: the gap's start and end, its length, and the note. Station lines already break there (P9); the
  shading says why. The gap code lives in `gaps.ts`, outside the chart controller (P17).
- Text and formats come from a `ChartLocale` the app provides (a d3 time-format locale, a number formatter and the
  chart's few strings), and `setLocale()` swaps it and marks the axes and overlay dirty. The chart holds no copy of
  its own (see Language).
- Colors come from an interpolator the app provides per theme (a single-hue sequential ramp for "mean
  occupancy", following the dataviz method). The chart doesn't hardcode a palette.

## Station map (T2.7)

A second view in the sidebar: every station as a point at its position, colored by how full it is at one moment.

- **Which moment:** the time under the chart's crosshair while the pointer is on the chart; otherwise the end of the
  visible range, so the map follows a zoom or pan.
- **Occupancy at t** (`fillAt` in core): per station, the last reading at or before t, by binary search in its
  series (O(stations × log n), cheap enough for the main thread). The value is bikes / capacity. A station whose
  last reading is older than the series' gap threshold, or without a capacity, has no value and is drawn as "no
  data", never as empty (P9).
- **Drawing:** `StationMap` (`@bicing/charts`) projects longitude/latitude with `d3-geo`'s `geoMercator().fitExtent`
  (P3). A `PointRenderer` (`@bicing/renderers`, WebGL2 `gl.POINTS`) uploads the projected positions on resize and
  the values when the moment changes. Colors come from the same ramp texture as the lines, and "no data" from a
  CSS custom property.
- **Hover:** a Flatbush index over the projected points (ADR 0008), rebuilt only on resize or new stations. The
  nearest station within 12 px gets a ring and a tooltip worded by the app (name, time, bikes of capacity).

## Linked views (Phase 3, ADR 0015)

Brushing one view filters the others, over the raw readings a view has loaded (synthetic data up to 10M rows, or a
real month).

- **Dimensions:** time (an x brush on the chart), hour of day in Barcelona time and occupancy (histograms), station
  (clicked on the map). Only in-service rows take part.
- **The worker:** owns the crossfilter. It keeps per-row station, hour bin and occupancy bin, a `Uint8` mask with one
  bit per dimension, and rows bucketed by bin. A brush move toggles only the rows that changed (bins entering or
  leaving, or the two end runs of a time range) and updates the histograms and per-station counts by delta.
- **The page:** gets each histogram counted under the _other_ filters, plus the per-station counts, in under 3 KB.
  It sends the next brush position only once the previous answer has arrived. The time series and the map dim
  stations with no passing reading, and the histograms draw the total faintly under what passes.
- **Not filtered:** the whole history's aggregate levels and the 50M stress tier hide the brushes.

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
- Phase 2 adds precomputed aggregates at 1 hour and 1 day (ADR 0014), picked by the visible span and drawn as
  min/max pairs, like min/max decimation.

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
