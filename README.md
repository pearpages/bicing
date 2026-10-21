# Bicing Pulse

An interactive explorer of Barcelona's public bike-sharing history, built to show one thing well:

> **Rendering millions of data points smoothly in the browser, with D3 doing the math and
> Canvas 2D / WebGL2 doing the drawing.**

Status: **Phase 2 complete.** The whole Bicing history from Open Data BCN (364M readings, 2019–2026) in the
browser, in Catalan and English:

- a time series that switches between daily, hourly and original readings as you zoom, at 60 fps;
- gaps shaded and explained, such as the autumn of 2025 that Open Data BCN never published correctly;
- a WebGL station map that follows the chart's crosshair.

**WebGL2 holds 60 fps at 10M points**, while SVG drops to 9 fps at 1M. **The whole history draws in 0.16 s**, and a
year in 0.35 s ([Benchmarks](#benchmarks)). Phase 3 links the views. See [tasks.md](tasks.md).

## What to look at

| Topic                                  | Where                                                    |
| -------------------------------------- | -------------------------------------------------------- |
| Architecture, package graph, data flow | [architecture.md](architecture.md)                       |
| The rules every change follows         | [principles.md](principles.md)                           |
| Decisions and their trade-offs         | [decisions.md](decisions.md)                             |
| Why Canvas/WebGL instead of SVG        | [ADR 0001](docs/adr/0001-canvas-webgl-for-data-marks.md) |
| Benchmark results                      | [Benchmarks](#benchmarks) (Phase 1 and real data)        |

## Getting started

Requires Node 24 LTS and pnpm 12 (pinned in `mise.toml`, `.nvmrc` and `package.json#packageManager`).

```bash
pnpm install
pnpm dev              # demo app on http://localhost:5173
pnpm test -- --run    # unit + property tests, single run
pnpm lint && pnpm typecheck
pnpm build            # production build of apps/web
pnpm prepare-data     # Open Data BCN archives → data/raw (~2.6 GB; --from/--to YYYY-MM, --dry-run)
pnpm prepare-data --read-month 2026-09   # one cached month → columns, with a data-quality report
pnpm prepare-data --build              # stage every month, publish data/parquet + gaps.json
                                        # then pick “Reals” in the app: dev/preview serve data/parquet at /data/
```

Docker (static build served by nginx, with cross-origin isolation headers):

```bash
docker build -t bicing-pulse .
docker run -p 8080:80 bicing-pulse
```

## Repository layout

```
packages/core        types, columnar store, algorithms (pure, no DOM)
packages/synthetic   seeded generator with the real schema
packages/data        worker protocol and entry points
packages/renderers   Renderer interface: SVG / Canvas 2D / WebGL2
packages/charts      framework-agnostic chart controllers (D3 scales, axes, zoom, brush)
packages/vue         thin Vue 3 bindings
apps/web             demo app and benchmark mode
tools/               Node CLIs (synthetic data, Open Data BCN preparation)
```

## Benchmarks

Every configuration plays the same scripted 5-second camera path on the live chart: a geometric zoom from the full
extent down to 5% of it, a pan across, and a zoom back out
([`scenario.ts`](apps/web/src/benchmark/scenario.ts)). It runs one view per animation frame, on the production build.
Frame times are measured with `requestAnimationFrame`, so they include everything a user would feel:
zoom handling, downsampling, upload, drawing and GPU time.

**Machine:** Apple M4 Pro (12 cores, 16 GB+), macOS, Chrome 153, devicePixelRatio 2, viewport 1978×1056 CSS px (a
3956×2112 backing store). Measured 2026-09-22 with seeded synthetic data (500 stations, 5-minute cadence).
Reproduce it with **Measure all** in the app.

| Renderer  | Readings | Downsampling |    FPS | Frame p50 (ms) | Frame p95 (ms) | Frames > 50 ms | Chart CPU p95 (ms) | First chart (ms) | Notes                                                  |
| --------- | -------: | ------------ | -----: | -------------: | -------------: | -------------: | -----------------: | ---------------: | ------------------------------------------------------ |
| SVG       |      10k | Off          |     60 |           16.7 |           16.7 |              0 |                3.0 |               23 |                                                        |
| Canvas 2D |      10k | Off          |     60 |           16.7 |           17.3 |              0 |                0.3 |               23 |                                                        |
| WebGL2    |      10k | Off          |     60 |           16.7 |           17.4 |              0 |                0.1 |               23 |                                                        |
| SVG       |     100k | Off          |     60 |           16.7 |           16.7 |              0 |               11.1 |               48 |                                                        |
| Canvas 2D |     100k | Off          |     60 |           16.7 |           17.0 |              0 |                1.4 |               48 |                                                        |
| WebGL2    |     100k | Off          |     60 |           16.7 |           17.4 |              0 |                0.2 |               48 |                                                        |
| SVG       |       1M | Off          |  **9** |          116.7 |          116.7 |             42 |              108.8 |              198 |                                                        |
| SVG       |       1M | Min/max      |     44 |           16.7 |           66.7 |             14 |               56.8 |              198 |                                                        |
| Canvas 2D |       1M | Off          |     59 |           16.7 |           17.0 |              0 |                8.2 |              198 |                                                        |
| Canvas 2D |       1M | Min/max      |     60 |           16.7 |           16.7 |              0 |               16.8 |              198 |                                                        |
| WebGL2    |       1M | Off          |     60 |           16.7 |           17.4 |              0 |                0.3 |              198 |                                                        |
| SVG       |      10M | Off          |      – |              – |              – |              – |                  – |              573 | Skipped: capped at 1M points                           |
| Canvas 2D |      10M | Off          |     46 |           16.7 |           66.7 |              9 |               52.0 |              573 |                                                        |
| Canvas 2D |      10M | Min/max      |     50 |           16.7 |           33.3 |              1 |               32.8 |              573 | 55 frames drew the previous downsampling               |
| WebGL2    |      10M | Off          | **60** |           16.7 |       **17.3** |          **0** |                0.6 |              573 |                                                        |
| WebGL2    |      10M | Min/max      |     60 |           16.7 |           16.7 |              1 |               14.2 |              573 | 93 frames drew the previous downsampling               |
| WebGL2    |      50M | Off          |     51 |           16.7 |           50.0 |             11 |                1.5 |            3,176 | Stress tier                                            |
| Canvas 2D |      50M | Min/max      |     50 |           16.7 |           50.0 |              1 |               31.4 |            3,176 | Stress tier; 248 frames drew the previous downsampling |

The full 26-configuration matrix (every renderer × size × {off, min/max}) comes out of the app as Markdown. The rows above are the
ones that tell the story. "Chart CPU" is the chart's own main-thread work per frame (downsampling, upload and draw
calls). GPU time is asynchronous and appears only in frame time. "First chart" runs from the click to the first
drawn frame: worker generation, transfer and the first draw.

**What the numbers say**

- **SVG falls over at 1M points**: 9 fps, and every frame over 100 ms of main-thread work spent building `d` strings for 533 paths.
  Downsampling helps (44 fps) but can't fix it. Past 1M, the SVG renderer refuses rather than freezing the tab.
- **WebGL2 holds 60 fps at 10M** with 0.6 ms of CPU per frame: the data is uploaded once, and each frame only sets
  uniforms and issues one multi-draw call.
- **That took a measurement to get right.** The first run showed WebGL at 47 fps at 10M, even though CPU was flat. A
  fixed-view test isolated MSAA: a full-extent 10M frame took 100 ms with it and 16.7 ms without it
  ([ADR 0009](docs/adr/0009-webgl-lines-without-msaa.md)).
- **Downsampling isn't free, and 500 series limit it.** At 1M, Canvas with min/max costs 16.8 ms of CPU against 8.2 ms
  without it: each station has ~2,000 points but the plot is ~3,900 device pixels wide, so there's nothing to drop. It pays off
  at 10M, where Canvas goes from a 66.7 ms to a 33.3 ms p95 ([ADR 0006](docs/adr/0006-decimation-strategy.md)).
- **50M is the edge**: 51 fps with WebGL, and 3.2 s to first chart (about 500 MB of columns generated in a worker).

### Real data (Phase 2)

How long it takes from asking for real data to its first drawn frame, in a cold tab (HTTP cache off, a new worker and
a fresh parquet-wasm instance per run): fetching the Parquet in the worker, decoding, validating, building the series,
transferring them, and the GPU upload. Each row is the median of 3 runs, on the local preview server and on a
throttled 50 Mbps / 20 ms profile.

**Machine:** Apple M4 Pro, macOS, headless Chrome 155 on WebGL2 (ANGLE Metal), 1400×900 CSS px, devicePixelRatio 1.
Measured 2026-10-21 on the published data from `pnpm prepare-data --build`. Reproduce it with
[`apps/web/scripts/bench-real-data.mjs`](apps/web/scripts/bench-real-data.mjs) against `vite preview`.

| Data                                   | Network        | Downloaded | Points drawn | First chart (ms) |
| -------------------------------------- | -------------- | ---------: | -----------: | ---------------: |
| One month, original readings (2026-09) | local          |    17.9 MB |    4,443,182 |          **302** |
| One month, original readings (2026-09) | 50 Mbps, 20 ms |    17.9 MB |    4,443,182 |            3,229 |
| One year, original readings (2024)     | local          |   189.9 MB |   52,749,411 |            2,526 |
| One year, original readings (2024)     | 50 Mbps, 20 ms |   189.9 MB |   52,749,411 |           33,089 |
| One year, hourly (2024)                | local          |    20.3 MB |    8,887,112 |          **347** |
| One year, hourly (2024)                | 50 Mbps, 20 ms |    20.3 MB |    8,887,112 |            3,707 |
| Whole history, daily (2019–2026)       | local          |    13.3 MB |    2,594,668 |          **164** |
| Whole history, daily (2019–2026)       | 50 Mbps, 20 ms |    13.3 MB |    2,594,668 |            2,370 |

"Downloaded" includes the 5.3 MB parquet-wasm module. `vite preview` serves it uncompressed; behind nginx with gzip
it's 1.8 MB, which would take about 0.6 s off every throttled row.

**What the numbers say**

- **A month of real data is on screen in 0.3 s locally:** 12.6 MB of Parquet, 4.4M readings decoded in the worker
  (ADR 0013).
- **Raw readings don't scale to a year:** 190 MB and 52.7M points. The GPU still draws it, but it takes 33 s on
  broadband. This is why the aggregates exist (ADR 0014).
- **The hourly year shows the same span in 0.35 s locally, or 3.7 s on broadband,** from 20 MB. The whole history at
  the daily level takes 0.16 s and 13 MB. "Tot l'historial" opens there and loads finer levels only for the window
  you zoom into (T2.5b).
- **On broadband, the network is the cost.** Every throttled row is within about 15% of the transfer time alone (bytes ÷ 50 Mbps), so
  the next win is fewer bytes: compressing the WASM, a Snappy-only build of it, or range requests for just the
  visible row groups.

Memory is shown live in the app, but it's left out of this table: `measureUserAgentSpecificMemory` resolves lazily, and
its samples lagged behind configuration changes during the automated run (see the Discovered list in
[tasks.md](tasks.md)).

## Data

Station status history and station information come from
[Open Data BCN](https://opendata-ajuntament.barcelona.cat/) (datasets `estat-estacions-bicing` and
`informacio-estacions-bicing`). `pnpm prepare-data` finds the monthly archives through the CKAN API and caches them in
`data/raw` (a re-run only fetches what changed). `pnpm prepare-data --build` stages and publishes them as Parquet,
with hourly and daily aggregates and a `gaps.json` (ADR 0012, ADR 0014). In the app, **Dades → Reals** loads a month
or the whole history; **Sintètiques** keeps the seeded generator that the Phase 1 benchmarks use.

## License

[MIT](LICENSE) © 2026 pearpages.
