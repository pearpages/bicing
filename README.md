# Bicing Pulse

An interactive explorer of Barcelona's public bike-sharing history, built to show one thing well:

> **Rendering millions of data points smoothly in the browser, with D3 doing the math and
> Canvas 2D / WebGL2 doing the drawing.**

Status: **Phase 0 (scaffolding) complete.** Phase 1 (rendering core on synthetic data) is in
progress. See [docs/TASKS.md](docs/TASKS.md).

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

_To be recorded at the end of Phase 1: renderer × dataset size, with FPS, frame time
percentiles, long tasks, memory and time-to-first-chart, plus the machine used._

## Data

Station status history and station information come from
[Open Data BCN](https://opendata-ajuntament.barcelona.cat/) (datasets `estat-estacions-bicing` and
`informacio-estacions-bicing`). Real data arrives in Phase 2. Until then, everything runs on
seeded synthetic data with the same schema.
