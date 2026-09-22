# 0003 — The synthetic generator is a package, not only a tool

- **Status:** Accepted
- **Date:** 2026-09-22
- **Principles:** P10, P12, P19

## Context

The bootstrap brief put the seeded generator in `tools/synthetic` and also said that nothing may
depend on `tools/*`. But benchmark mode has to generate 10k–50M rows **in the browser** (in a
worker), so the app can't import code from `tools/`. We'd have to break the dependency rule,
duplicate the generator, or ship pre-generated files of up to 500 MB.

## Decision

- `packages/synthetic` (`@bicing/synthetic`) holds the generator. It's pure TS with no DOM and no Node
  APIs, and it depends only on `core`.
- `tools/synthetic` is a thin Node CLI over it (`pnpm synth --seed 42 --rows 1e6 --out data/x`). It
  writes raw little-endian column files + `manifest.json` + `stations.json` now, and Parquet in Phase 2.
- `data` may depend on `synthetic`, because its worker runs the generator.

Generator design, in brief: mulberry32 PRNG (seedable, 32-bit state). Stations get a role derived
from their position: central stations fill during working hours, and outer/uphill ones empty. On top
of that come a commute-shaped daily curve (flatter at weekends), an AR(1) drift per station, e-bike
shares of 10–40%, and closures on about 1% of station-days. Output is written directly in store order
(t, stationIdx) into preallocated typed arrays, with no per-row allocation.

## Consequences

- Positive: the same code, from the same seed, feeds unit tests, the CLI and the in-browser benchmark,
  so the numbers are reproducible (P19).
- Positive: no large binary artifacts in the repo or on the demo host for the benchmark.
- Measured (Apple Silicon laptop, Node 24): 1M rows in 71 ms, 10M in 0.66 s, 50M in 3.2 s. The 50M
  tier must run in a worker (P8).
- Negative: one more package in the graph.

## Alternatives considered

- **Keep it in `tools/` and allow `data → tools/synthetic`.** Breaks a clean rule for a special case.
- **Pre-generate files for each size.** Up to 500 MB per tier to host and download. It also measures
  network speed, not rendering.
- **Put the generator in `core`.** Pure enough, but it would bloat the package every consumer loads.
