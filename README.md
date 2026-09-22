# Bicing Pulse

An interactive explorer of Barcelona's public bike-sharing history, built to show one thing well:

> **Rendering millions of data points smoothly in the browser, with D3 doing the math and
> Canvas 2D / WebGL2 doing the drawing.**

Status: **Phase 1 complete.** A rendering core on seeded synthetic data: SVG, Canvas 2D and WebGL2 renderers behind
one interface, min/max and LTTB downsampling, a D3-driven time series with zoom and hover, and a benchmark mode.
**WebGL2 holds 60 fps at 10M points** on the reference machine, while SVG drops to 9 fps at 1M ([Benchmarks](#benchmarks)).
Phase 2 brings the real Open Data BCN history. See [docs/TASKS.md](docs/TASKS.md).

## What to look at

| Topic                                  | Where                                                    |
| -------------------------------------- | -------------------------------------------------------- |
| Architecture, package graph, data flow | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)             |
| The rules every change follows         | [docs/PRINCIPLES.md](docs/PRINCIPLES.md)                 |
| Decisions and their trade-offs         | [docs/adr/](docs/adr/)                                   |
| Why Canvas/WebGL instead of SVG        | [ADR 0001](docs/adr/0001-canvas-webgl-for-data-marks.md) |
| Benchmark results                      | [Benchmarks](#benchmarks) (Phase 1)                      |

## Getting started

Requires Node 24 LTS and pnpm 12 (pinned in `mise.toml`, `.nvmrc` and `package.json#packageManager`).

```bash
pnpm install
pnpm dev              # demo app on http://localhost:5173
pnpm test -- --run    # unit + property tests, single run
pnpm lint && pnpm typecheck
pnpm build            # production build of apps/web
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

Memory is shown live in the app, but it's left out of this table: `measureUserAgentSpecificMemory` resolves lazily, and
its samples lagged behind configuration changes during the automated run (see the Discovered list in
[docs/TASKS.md](docs/TASKS.md)).

## Data

Station status history and station information come from
[Open Data BCN](https://opendata-ajuntament.barcelona.cat/) (datasets `estat-estacions-bicing` and
`informacio-estacions-bicing`). Real data arrives in Phase 2. Until then, everything runs on
seeded synthetic data with the same schema.
