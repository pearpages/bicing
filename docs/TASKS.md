# Tasks

Rules: work top to bottom. Tick `[x]` in the commit that completes the task, and put `Task: <ID>` in the commit body.
New work goes under **Discovered**. Phases 2–3 are placeholders until Phase 1 is done.

## Phase 0 — Scaffolding

- [x] **T0.0** Governing docs: ARCHITECTURE.md, PRINCIPLES.md, TASKS.md, CLAUDE.md with the imports. _Done when:_ committed.
- [x] **T0.1** pnpm workspace, `.nvmrc` 24, `packageManager`, Prettier, `.editorconfig`, `.gitignore` (data/, dist/). _Done when:_ `pnpm install` is clean.
- [x] **T0.2** `tsconfig.base.json` (strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes, verbatimModuleSyntax), per-package tsconfigs checked with `tsc --noEmit` via `pnpm -r` (no project references: packages ship TS source, so there is nothing to emit), `core`/`synthetic` compile without the DOM lib (enforces P12), TS 6.0.3 pinned. _Done when:_ `pnpm typecheck` passes on the empty packages.
- [x] **T0.3** ESLint flat config: typescript-eslint strictTypeChecked, eslint-plugin-vue, boundaries rules for the graph. _Done when:_ an illegal import (core → charts) fails lint (verified, then reverted).
- [x] **T0.4** Vitest root config with `test.projects`. _Done when:_ a smoke test runs per package.
- [x] **T0.5** `apps/web`: Vite + Vue app, CSS Modules (.module.scss), COOP/COEP headers in dev. _Done when:_ `pnpm dev` renders a shell and `crossOriginIsolated === true`.
- [x] **T0.6** GitHub Actions CI: install → lint → typecheck → test → build on Node 24 with a pnpm cache. _Done when:_ every workflow step passes locally (no remote yet — the first green run is tracked as D1).
- [x] **T0.7** Multi-stage Dockerfile + nginx.conf with COOP/COEP headers. _Done when:_ `docker build` works and the headers are present.
- [x] **T0.8** README skeleton, ADR 0001 (Canvas/WebGL for data marks), ADR 0002 (TypeScript 6 pin). _Done when:_ committed.

## Phase 1 — Rendering core with synthetic data

- [x] **T1.1** core: types, `Status`, time epoch, `lowerBound`/`upperBound`, `timeSlice`. Tests. _Done when:_ the edge cases pass.
- [x] **T1.2** core: per-station series index (permutation + offsets) and gap segmentation. Tests.
- [x] **T1.3** synthetic: mulberry32 PRNG, the station layout, daily profiles, closures, optional gaps, sorted output; `tools/synthetic` CLI. ADR 0003. _Done when:_ the same seed gives byte-identical output and the sort invariant holds (property test).
- [x] **T1.4** core: `minMaxPerPixel` + example and property tests. _Done when:_ extremes, endpoints and gap boundaries are preserved.
- [x] **T1.5** core: `lttb` + example and property tests. ADR 0006. _Done when:_ the output size is ≤ the threshold, the endpoints are kept, and n ≤ threshold gives the identity.
- [x] **T1.6** data: typed protocol, worker `generate` with transfer lists, client with request ids. ADR 0005. _Done when:_ a test shows that the transferred buffers are detached on the sender.
- [x] **T1.7** renderers: the `Renderer` interface, DPR sizing, `SvgRenderer` (1M cap), `CanvasRenderer`. ADR 0004.
- [x] **T1.8** renderers: `WebGLRenderer`: GPU buffers uploaded once, integer `t` attribute with origin subtraction, color-ramp texture from a d3 interpolator, context-loss handling.
- [x] **T1.9** charts: `FrameScheduler` (rAF coalescing, dirty layers) + tests with a fake rAF.
- [x] **T1.10** charts: `TimeSeriesChart`: layered DOM, d3-scale/axis/zoom, decimation on zoom over the visible slice, renderer swap.
- [ ] **T1.11** charts: hover picking with flatbush over the drawn vertices.
- [ ] **T1.12** vue: `useTimeSeriesChart` composable + `TimeSeriesChart.vue`, non-reactive data. ADR 0007. _Done when:_ a test asserts that the data is not a Proxy.
- [ ] **T1.13** web: benchmark mode (renderer × size × decimation), `PerfOverlay` (FPS, frame p50/p95, long animation frames, memory), time-to-first-chart.
- [ ] **T1.14** web: scripted 5-second pan/zoom run → results table (copyable Markdown).
- [ ] **T1.15** Run the benchmarks and record the results + machine in the README. _Done when:_ WebGL is ~60 fps at 10M, and SVG degradation is shown with numbers.
- [ ] **T1.16** Phase 1 summary in README / CLAUDE.md. Draft Phase 2 tasks here.

## Phase 2 — Real data (to be broken down at the end of Phase 1)

- [ ] prepare-data CLI (CKAN discovery, 7z, DuckDB, Parquet, gaps.json) · Parquet loading in a worker · multi-resolution aggregates · gap rendering · map view.

## Phase 3 — Linked views (to be broken down later)

- [ ] histograms · bitset crossfilter in a worker · map time scrubber · Playwright brushing tests · final benchmarks.

## Discovered

- [ ] **D1** Add a GitHub remote, push, and confirm the CI run is green (T0.6 was only verified locally).
