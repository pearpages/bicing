# 0016 — Browser tests: Playwright on Chromium, against the built app, in their own CI job

- **Status:** Accepted
- **Date:** 2026-10-21
- **Principles:** P5, P19, P20

## Context

Phase 3's brushes only work as a whole in a real browser. `d3-brush` and `d3-zoom` share gestures on the time
series, the histograms answer through the data worker, and the chart and map dim through WebGL. The unit tests
drive each piece in jsdom, which has no layout, no WebGL and no workers. A bug that unit tests missed (T3.4: the
time series stayed blank because a brush was set before the first resize) showed up only in the browser.

CI runners have no GPU and no real data (the parquet is git-ignored), so tests must run on synthetic data (P19)
with software WebGL2.

## Decision

- **Runner:** `@playwright/test`, testing the production build served by `vite preview`, like the benchmarks
  (AGENTS.md: dev builds mislead).
- **Browser:** Chromium only, headless, with SwiftShader for WebGL2 (`--enable-unsafe-swiftshader`). The tests
  check behaviour (what's filtered, dimmed, cleared), not frame times, so software rendering is enough.
- **Data:** synthetic and seeded (P19). The specs pick a small size so the worker answers in well under a second.
- **Where:** `apps/web/e2e/*.e2e.ts`. The suffix keeps them out of Vitest's default `*.test.ts`/`*.spec.ts` globs.
- **CI:** a separate `e2e` job, in parallel with `check`, which caches the Chromium download. A failure uploads
  the Playwright report.

## Consequences

- One more dev dependency and a ~100 MB browser download, cached in CI.
- Locally it's `pnpm e2e` (build, then test). It isn't part of `pnpm test -- --run`, which stays fast.
- Cross-browser behaviour (Firefox, Safari) is still checked by hand.

## Alternatives considered

- **All three engines.** Catches engine differences, but triples downloads and run time, and WebKit's software
  WebGL on Linux is the flakiest. Can be added later, project by project.
- **Vitest browser mode.** One fewer runner, but it mounts components in isolation, not the built app on
  `vite preview`, which is what has to work.
- **Cypress.** A larger dependency, and no advantage for a Chromium-only suite.
