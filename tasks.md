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
- [ ] **T2.3** Write Parquet (one file per month plus a merged file) and `gaps.json` (missing days and months, detected, not assumed). _Done when:_ the known gaps appear in gaps.json.
- [ ] **T2.4** ADR: choosing the browser Parquet reader. Loading in the data worker, with zero-copy transfer into the existing protocol, from a configurable external base URL (CORS + range requests).
- [ ] **T2.5** Multi-resolution aggregates (5 min / 1 h / 1 day min-max-mean per station), picked by the visible span, so zoomed-out views stay small (feeds D3, D5).
- [ ] **T2.6** Gap handling from gaps.json: shade missing periods in the chart and state them in the tooltip; lines already break at gaps (P9).
- [ ] **T2.7** Map view: ~500 stations as WebGL points colored by occupancy at a selected time; hover with flatbush over station positions (ADR 0008).
- [ ] **T2.8** Benchmarks on real data: time to first chart for 1 month and 1 year, recorded in the README.

### Phase 3 — Linked views (to be broken down later)

- [ ] histograms · bitset crossfilter in a worker · map time scrubber · Playwright brushing tests · final benchmarks.

### Discovered

- [x] **D1** Add a GitHub remote, push, and confirm the CI run is green (T0.6 was only verified locally).
- [ ] **D2** Reliable memory measurement: sample `measureUserAgentSpecificMemory` after each load settles and await it inside the run. The current 5 s polling lags behind configuration changes, so memory is left out of the README table.
- [ ] **D3** Decimation fast path: when a series' visible points ≤ 4 × pixels, take them as they are (Canvas at 1M with min/max costs 2× the CPU of no downsampling).
- [ ] **D4** Don't re-decimate every frame while the result is over the renderer's cap (SVG at 10M with min/max still spends ~72 ms/frame to learn it's skipped).
- [ ] **D5** WebGL at 50M: 11 frames over 50 ms at full extent. Profile the GPU side (fill vs vertex) and consider LOD from the Phase 2 aggregates.
- [ ] **D6** Shader-based line antialiasing (quads with feathered edges) as the quality alternative to MSAA (ADR 0009).
- [ ] **D7** Accessible table view of the chart data (dataviz requirement: identity and values not only in pixels).
- [ ] **D8** When the renderer is swapped, the chart re-uploads; show "uploading" in the overlay instead of a stale frame report.
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
