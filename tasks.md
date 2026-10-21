# Tasks

Rules: work top to bottom through **Open**. Tick `[x]` in the commit that completes the task, and put `Task: <ID>` in
the commit body. New work goes under **Discovered**. Each session adds a dated line at the top of **Done**; finished
phases move there with their task IDs intact.

## Open

### Language — Catalan first, English second (before Phase 2)

ADR 0011, P27. Done before Phase 2 so the Phase 2 UI is written in Catalan from the start.

- [x] **I1** web: `i18n/` with `messages.ca.ts` (source, defines `Messages`) and `messages.en.ts: Messages`; `useI18n` with resolution `?lang=` → localStorage (try/catch) → `ca`; updates `<html lang>`, title and description; a language switcher (Català / English) in the header; `index.html` in Catalan. _Done when:_ removing a key from `en` fails typecheck (verified, then reverted) and resolution is unit-tested.
- [x] **I2** charts: a `ChartLocale` option and `setLocale()` (axes and overlay dirty); axis ticks and the tooltip use a `d3-time-format` locale (`ca-ES`, `en-GB`), with numbers, the station label, the cap message and the accessible label from the locale; the Vue binding passes it through. _Done when:_ tests show Catalan month and weekday names on the axis and in the tooltip, and switching locale redraws without re-uploading data.
- [x] **I3** web: move all UI copy into the dictionaries (controls, perf panel, legend, frame trace, results dialog, benchmark notes and exported Markdown) and format numbers with the active locale. _Done when:_ no user-facing English literal is left in `apps/web/src` outside `i18n/` (grep), and both languages are checked in the browser.

### Phase 2 — Real data

Check versions before adding anything (P25). Parquet in the browser: compare `hyparquet` (pure JS, range requests),
`parquet-wasm` and DuckDB-WASM (only dev builds were published as of 2026-09) in an ADR before choosing.

- [x] **T2.1** `tools/prepare-data`: discover resources with CKAN `package_show` (no hardcoded URLs); download with an idempotent cache under `data/`. _Done when:_ a second run downloads nothing.
- [x] **T2.2** Extract the monthly 7z archives with 7z-wasm; read the CSVs with DuckDB (Node), selecting columns by header name; time from `last_reported`, deduplicated per (station, minute); join the station information; map IDs to dense indices; cast to the compact types, dropping and counting invalid rows; sort by (t, stationIdx). ADR 0012. _Done when:_ one month round-trips into the ObservationColumns schema, with tests on a fixture. _(Amended 2026-10-20: the archives hold CSV, not JSON snapshots.)_
- [x] **T2.3** Write Parquet (one file per month plus a merged file) and `gaps.json` (missing days and months, detected, not assumed). _Done when:_ the known gaps appear in gaps.json.
- [x] **T2.4** ADR: choosing the browser Parquet reader. Loading in the data worker, with zero-copy transfer into the existing protocol, from a configurable external base URL (CORS + range requests).
- [x] **T2.5a** Build the aggregates (ADR 0014): per station and UTC bucket, over in-service readings, `min`/`max`/`mean`/`count` of bikes; `agg-1d.parquet` and `agg-1h-<YYYY>.parquet`, listed in `manifest.json`. _Done when:_ fixture tests check the values, and the full build's aggregates match the raw files (row counts, extremes). _(Amended 2026-10-21: no 5-minute level, which would be 3% smaller than raw; split from T2.5.)_
- [x] **T2.5b** Load the level the visible span needs (raw / 1 h / 1 day) for the visible range, without resetting the zoom; buckets drawn as min/max pairs (ADR 0014); a "Whole history" option. Feeds D3, D5. _Done when:_ zooming from the whole history down to one day switches levels in the browser, measured at 60 fps on WebGL.
- [x] **T2.6** Gap handling from gaps.json: shade missing periods in the chart and state them in the tooltip; lines already break at gaps (P9).
- [x] **T2.7** Map view: ~500 stations as WebGL points colored by occupancy at a selected time; hover with flatbush over station positions (ADR 0008).
- [x] **T2.8** Benchmarks on real data: time to first chart for 1 month and 1 year, recorded in the README.

### Phase 3 — Linked views

Brushing one view filters the others, over the raw readings a view has loaded (synthetic data or a real month; the
aggregate levels of the whole history aren't filtered). Budget: no main-thread task over 50 ms while brushing
(architecture.md > Performance budgets). Check versions before adding anything (P25).

- [x] **T3.0** ADR: the crossfilter. Which dimensions (time, hour of day, occupancy, station); one bitset per dimension in the data worker with incremental updates on each brush move; what crosses threads (histogram counts and a per-station selection, transferred, versus a `SharedArrayBuffer` mask, ADR 0005); and what the chart and map do with a selection (dim the rest). _Done when:_ the owner accepts it.
- [x] **T3.1** core: the crossfilter engine of ADR 0015, pure and DOM-free (P12): bin indexes (a counting sort per binned dimension), a per-row mask with one bit per dimension, incremental updates for bin sets and time row ranges, and each histogram (under the _other_ filters) and the per-station counts kept by delta. Examples and fast-check properties against a brute-force filter (P18). _Done when:_ a brush move over 10M rows updates in under 16 ms in Node, measured with a committed benchmark. _(Amended 2026-10-21 to match ADR 0015: a per-row mask with bin indexes, not set/AND/popcount bitsets.)_
- [x] **T3.2** data: run the T3.1 engine in the worker. Derive each row's hour of day (Barcelona time, through a DST offset table) and occupancy bin when data loads, keep them with the station column, and add `filter` messages to the protocol, answered with the histograms and per-station counts (one update in flight). _Done when:_ tests drive it through the worker handler, and a brush update on a real month (4.5M rows) takes under 16 ms in the worker.
- [x] **T3.3** charts: an x brush on the time series (`d3-brush`), and a `HistogramChart` controller (D3 scales and axis, Canvas bars, its own brush) for hour of day and occupancy. _Done when:_ jsdom tests drive both brushes and the bars follow new counts.
- [x] **T3.4** web: the linked layout. The time series, two histograms and the map; brushing any of them filters the rest, the chart and map dim what's filtered out, and there's a "clear filters" action, in both languages. _Done when:_ brushing works in the browser on a real month with no long task over 50 ms, measured.
- [x] **T3.5** web: a map time scrubber. A slider (and play) for the map's moment, alongside the crosshair it follows today (T2.7). _Done when:_ scrubbing a month redraws the map at 60 fps.
- [x] **T3.6** Playwright brushing tests against `vite preview` on synthetic data (CI has no real data), run in CI. _Done when:_ CI runs them green.
- [x] **T3.7** Final benchmarks: brush latency (worker update and main-thread frame) on 1M and 10M synthetic readings and a real month, recorded in the README with the method (P5). _Done when:_ the README table is in.

### Discovered

- [x] **D1** Add a GitHub remote, push, and confirm the CI run is green (T0.6 was only verified locally).
- [ ] **D2** Reliable memory measurement: sample `measureUserAgentSpecificMemory` after each load settles and await it inside the run. The current 5 s polling lags behind configuration changes, so memory is left out of the README table.
- [ ] **D3** Decimation fast path: when a series' visible points ≤ 4 × pixels, take them as they are (Canvas at 1M with min/max costs 2× the CPU of no downsampling).
- [ ] **D4** Don't re-decimate every frame while the result is over the renderer's cap (SVG at 10M with min/max still spends ~72 ms/frame to learn it's skipped).
- [ ] **D5** WebGL at 50M: 11 frames over 50 ms at full extent. Profile the GPU side (fill vs vertex) and consider LOD from the Phase 2 aggregates.
- [ ] **D6** Shader-based line antialiasing (quads with feathered edges) as the quality alternative to MSAA (ADR 0009).
- [ ] **D7** Accessible table view of the chart data (dataviz requirement: identity and values not only in pixels).
- [ ] **D8** When the renderer is swapped, the chart re-uploads; show "uploading" in the overlay instead of a stale frame report.
- [ ] **D14** Fewer bytes for real data: on 50 Mbps every load is within ~15% of its transfer time (README > Real data). Serve `.wasm` and the data with gzip/brotli (nginx and the data host, A9), consider the Snappy-only parquet-wasm build (ADR 0013), and range requests for the visible row groups.
- [ ] **D15** `apps/web/src/App.module.scss` repeats the `.actions`, `.primary`, `.secondary` and `.progress` rules unchanged inside the 860 px media query: drop the copies.
- [ ] **D13** Outlier readings squash the y-axis: a few readings report up to 198 bikes at stations with ~50 docks, so the whole-history axis runs to 200 while the data sits under ~55. Decide at ingest (flag readings far above capacity, ADR 0012) or in the chart (a robust y-domain); don't hide them silently (P9).
- [ ] **D12** `prepare-data` downloads: retry HTTP 429/503 with backoff. On 2026-10-20 a full run at `--concurrency 3` got 165 × HTTP 503 after 9 downloads; one at a time worked. Consider making 1 the default.
- [x] **D11** ~~2019-era information CSVs have a misaligned header~~. Measured: only station 1's rows in 2019-03 are shifted. Handled in T2.2 by checking capacity against the readings (ADR 0012).
- [ ] **D10** Synthetic station names are English (`Synthetic station 014`) and show in the Catalan tooltip: name them neutrally or in Catalan in `packages/synthetic` (real names replace them in Phase 2).
- [ ] **D9** Split `packages/charts/src/TimeSeriesChart.ts` (~520 lines, P17 says ~250): axes, hover/tooltip and the zoom policy are separable.

### Scaffold follow-ups

- [x] **S1** Point the code comments at the moved docs — `eslint.config.js:11` and `apps/web/src/App.vue:133` still say
      `docs/ARCHITECTURE.md` / `docs/TASKS.md`, and `packages/charts/src/layers.ts:3` and `.gitignore:6` say `ARCHITECTURE.md`;
      the scaffold skill doesn't touch code or tooling.
- [ ] **S2** Give P1–P25 in `principles.md` a _Why_ and, where something enforces them (boundaries lint, tsconfig
      flags, CI), a _Check_ — the knowledge-file standard asks for both (ADR 0010).
- [ ] **S3** Enable GitHub private vulnerability reporting once D1 creates the remote, and update
      `security.md` > Reporting.

### Advertising readiness

- [ ] **A9 Live demo.** A portfolio link must land on a running app, and today there is none: pick a host that can send COOP/COEP headers (GitHub Pages can't; Netlify/Cloudflare Pages `_headers`, or the existing Docker/nginx image), serve it at `bicing.soms.cat` (`CNAME`) and set `homepage` in `package.json`. Host choice has trade-offs, so it gets an ADR.
- [ ] **A8 Open Graph tags.** Link previews on LinkedIn/X show no image or summary: add static `og:title/description/image/url/image:alt` and `twitter:card=summary_large_image` to `apps/web/index.html`, plus a 1200×630 card from a benchmark screenshot (og-card skill).
- [ ] **A6 README first screen.** No image and no live link above the fold: add the card or a screenshot/GIF of the 10M-point zoom at the top, and a "Live demo" link once A9 is done (`README.md`).
- [ ] **C15 Deploy pipeline.** Nothing publishes the site: add a deploy job to `.github/workflows/ci.yml` on push to main (after D1 and A9).
- [ ] **C17 README overclaims brush.** The repository layout says `packages/charts` has a brush, but no brush exists until Phase 3: mark it as planned (`README.md` > Repository layout).
- [ ] **B11 GitHub repo metadata.** `pearpages/bicing` has no description, website or topics, so it looks abandoned in search and on the profile: set them (`gh repo edit`), with the website pointing at `bicing.soms.cat` once A9 is live.
- [ ] **B12 Favicon.** Tabs and bookmarks show the browser default: add a favicon and apple-touch-icon to `apps/web/index.html`.
- [ ] **B13 README badges.** No CI or license badges near the title: add them once the GitHub remote exists (D1).
- [ ] **B10 package.json metadata.** `description`, `repository`, `homepage`, `bugs` and `author` are empty in the root `package.json`, so GitHub and tooling show nothing.
- [ ] **C16 Release notes.** Nothing tells a visitor what's in the current version: tag the Phase 1 state as a GitHub Release with notes (after D1).
- [ ] **E23 Contributor files.** Nice-to-have, doesn't block: CONTRIBUTING and issue/PR templates.

## Done

- [x] 2026-10-21: T3.7 done, Phase 3 complete — brush latency in the README (README > Linked views): round trip p50 under 12 ms everywhere, worst p95 22 ms (occupancy on 10M), no long task in 3,240 brushed frames (worst 18.2 ms), on 1M and 10M synthetic and September 2026; `apps/web/scripts/bench-brush.mjs` reproduces it from the app's `bicing:filter` User Timing measures.
- [x] 2026-10-21: T3.6 done — five Playwright browser tests (ADR 0016: Chromium, software WebGL2, synthetic 100k on `vite preview`) cover the brushes, map picks, "clear filters", Catalan strings and the scrubber; green in CI's new `e2e` job on the first run (17 s of tests, 71 s for the job), and they fail on T3.4's blank-chart bug.
- [x] 2026-10-21: T3.5 done — a time scrubber under the map (5-minute steps, play over ~30 s by wall clock, "follow the view" to unpin), in both languages. On September 2026 (`vite preview`): scrubbing the whole month back and forth one step per frame, 723 frames at 60 fps (p95 17.3 ms, worst 18.6 ms, 0 long tasks); play also 60 fps (M4 Pro, Chrome 155).
- [x] 2026-10-21: T3.4 done — linked views: the time series, an hour-of-day and an occupancy histogram, and the map (click to pick stations) filter each other through the worker's crossfilter, with filtered-out stations dimmed and a "clear filters" action in both languages. Brushing September 2026 (4.4M readings) on `vite preview`: 1,080 brushed frames, 0 long tasks, frame p95 17.7 ms, worst 18.5 ms (M4 Pro, Chrome 155, dpr 2). Found D15.
- [x] 2026-10-21: T3.3 done — a time brush on the time series (shift + drag, kept in minutes through zoom) and `HistogramChart` (D3 axes, Canvas bars, a bin-snapping brush), both driven by real mouse events in jsdom tests.
- [x] 2026-10-21: T3.2 done — the crossfilter runs in the worker: filters for the latest raw dataset (by generation), one update in flight in the client, Barcelona hours checked against Intl; on a real month a brush update takes 11.1 / 3.3 / 0.57 ms p99 (occupancy / hour / time), a load 28 ms and the first filter 90 ms.
- [x] 2026-10-21: T3.1 done — `Crossfilter` and `buildBinIndex` in core, checked against a brute-force filter by fast-check; at 10M rows a drag updates in 8.0 ms p99 (occupancy), 5.8 ms (hour) and 1.2 ms (time), a whole-axis jump in 41 ms mean (`pnpm bench -- --run`, M4 Pro).
- [x] 2026-10-21: T3.0 done — ADR 0015 accepted: an incremental crossfilter in the data worker (measured 1.3 ms per brush drag at 4.5M rows and 3.4 ms at 10M, against 21 / 47 ms for a full scan), four dimensions, stations dimmed as a whole.
- [x] 2026-10-21: T2.8 done, Phase 2 complete — real-data time to first chart recorded in the README (cold, median of 3, M4 Pro): a month 0.30 s, a year hourly 0.35 s, the whole history daily 0.16 s locally; 3.2 / 3.7 / 2.4 s on 50 Mbps, against 33 s for a raw year. Found D14.
- [x] 2026-10-21: T2.7 done — a station map in the sidebar (WebGL2 points, d3-geo projection, Flatbush hover) shows occupancy at the chart's crosshair time, or the end of the view; a crosshair sweep moved it through 61 moments at 60 fps (p95 16.7 ms) in headless Chrome. Stale stations show as "no data" (P9).
- [x] 2026-10-21: T2.6 done — the 295 gaps of `gaps.json` are shaded in real data, and hovering one says there's no data, from when to when, how long, and why when known (e.g. 2025-09-30 → 12-09, 69 days: November not published, October's archive wrong). A month view spans its calendar month, so a late start or early end shows; checked in headless Chrome in both languages.
- [x] 2026-10-21: T2.5b done — “Tot l'historial” opens the whole history in ~0.1 s at the daily level and switches to hourly (~3 weeks) and raw readings (≤ 7 days) as you zoom, keeping the view; measured at 60 fps (p95 16.7 ms, 0 frames over 50 ms) at every stage on WebGL2 (Apple M4 Pro, headless Chrome 155). Found D13.
- [x] 2026-10-21: T2.5a done — `agg-1d.parquet` (1,297,334 rows, 8 MB) and 8 yearly `agg-1h` files (30,689,062 rows); counts sum to every in-service reading, extremes match, and a recomputed station-year matches bucket for bucket (ADR 0014).
- [x] 2026-10-20: T2.4 done — parquet-wasm in the data worker (ADR 0013; 107 ms vs 484 ms for hyparquet on a month); “Reals” in the app loads a real month in ~0.3 s (setembre del 2026: 4,443,182 points at 61 fps), checked in headless Chrome in both languages.
- [x] 2026-10-20: T2.3 done — `pnpm prepare-data --build`: 364,565,534 readings from 561 stations in 89 monthly Parquet files + a merged one (1.19 GB), and `gaps.json` with the known gaps (2019-03 late start, 2025-10 unusable, 2025-11 missing, 2026-09 early end) plus 2020-03 and 2023-08 found in the data; 3 broken upstream archives handled (ADR 0012).
- [x] 2026-10-20: T2.2 done — a cached month → `ObservationColumns` + `StationTable` in ~3 s (2026-09: 4,468,778 readings, 542 stations); stale reports and shifted capacities handled (ADR 0012).
- [x] 2026-10-20: T2.1 done — `pnpm prepare-data` finds 180 monthly archives (~2.6 GB, 2019-03 → 2026-09) via CKAN and caches them in `data/raw`; a second run downloads nothing.
- [x] 2026-10-20: I3 done — all UI copy, notes and the exported Markdown in the `ca`/`en` dictionaries, numbers in the active locale; both languages checked in Chrome.
- [x] 2026-10-20: I2 done — `ChartLocale` + `setLocale()`: Catalan/English axis ticks, tooltip and cap message; no re-upload on switch.
- [x] 2026-10-20: I1 done — typed `ca`/`en` dictionaries, `useI18n`, language switcher, Catalan `index.html`.
- [x] 2026-09-28: Planned Catalan-first i18n (ADR 0011, P27): tasks I1–I3 go before Phase 2.
- [x] 2026-09-28: D1 done — repo pushed to `pearpages/bicing`, CI green on the first run.
- [x] 2026-09-26: Maturity assessment — verdict Not ready, 11 gaps added to Open.
- [x] 2026-09-26: Scaffolded project knowledge files — 5 created, 7 fixed, 3 follow-ups (ADR 0010).
- [x] 2026-09-22: Phases 0 and 1 done (T0.1–T1.16). Measured WebGL2 at 60 fps with 10M points and SVG at 9 fps with 1M; the
      first run missed the target until MSAA turned out to cost 6× (ADR 0009).
- [x] 2026-09-21: Planned Phases 0–1 (React → Vue per user request, ADR 0007; TS 6.0.3 pinned, ADR 0002). Wrote the
      governing docs (T0.0).

### Phase 1 — Rendering core with synthetic data

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
- [x] **T1.11** charts: hover picking by per-series binary search at the pointer's time (O(stations × log n), exact on full-resolution data, no index to rebuild on zoom), with a crosshair, point marker and SVG tooltip. ADR 0008. Flatbush moves to the Phase 2 map view, where points are scattered in 2D. _Done when:_ picking is tested (nearest line, gaps never picked) and hover works in the browser.
- [x] **T1.12** vue: `useTimeSeriesChart` composable + `TimeSeriesChart.vue`, non-reactive data. ADR 0007. _Done when:_ a test asserts that the data is not a Proxy.
- [x] **T1.13** web: benchmark mode (renderer × size × decimation), `PerfOverlay` (FPS, frame p50/p95, long animation frames, memory), time-to-first-chart.
- [x] **T1.14** web: scripted 5-second pan/zoom run → results table (copyable Markdown). _Note:_ unit-tested (path, Markdown); the first complete live run happens in T1.15, which needs a visible browser window (background tabs pause rAF).
- [x] **T1.15** Run the benchmarks and record the results + machine in the README. _Done when:_ WebGL is ~60 fps at 10M, and SVG degradation is shown with numbers.
- [x] **T1.16** Phase 1 summary in README / CLAUDE.md. Draft Phase 2 tasks here.

### Phase 0 — Scaffolding

- [x] **T0.0** Governing docs: ARCHITECTURE.md, PRINCIPLES.md, TASKS.md, CLAUDE.md with the imports. _Done when:_ committed.
- [x] **T0.1** pnpm workspace, `.nvmrc` 24, `packageManager`, Prettier, `.editorconfig`, `.gitignore` (data/, dist/). _Done when:_ `pnpm install` is clean.
- [x] **T0.2** `tsconfig.base.json` (strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes, verbatimModuleSyntax), per-package tsconfigs checked with `tsc --noEmit` via `pnpm -r` (no project references: packages ship TS source, so there is nothing to emit), `core`/`synthetic` compile without the DOM lib (enforces P12), TS 6.0.3 pinned. _Done when:_ `pnpm typecheck` passes on the empty packages.
- [x] **T0.3** ESLint flat config: typescript-eslint strictTypeChecked, eslint-plugin-vue, boundaries rules for the graph. _Done when:_ an illegal import (core → charts) fails lint (verified, then reverted).
- [x] **T0.4** Vitest root config with `test.projects`. _Done when:_ a smoke test runs per package.
- [x] **T0.5** `apps/web`: Vite + Vue app, CSS Modules (.module.scss), COOP/COEP headers in dev. _Done when:_ `pnpm dev` renders a shell and `crossOriginIsolated === true`.
- [x] **T0.6** GitHub Actions CI: install → lint → typecheck → test → build on Node 24 with a pnpm cache. _Done when:_ every workflow step passes locally (no remote yet — the first green run is tracked as D1).
- [x] **T0.7** Multi-stage Dockerfile + nginx.conf with COOP/COEP headers. _Done when:_ `docker build` works and the headers are present.
- [x] **T0.8** README skeleton, ADR 0001 (Canvas/WebGL for data marks), ADR 0002 (TypeScript 6 pin). _Done when:_ committed.
