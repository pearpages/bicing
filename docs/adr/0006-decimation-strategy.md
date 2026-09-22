# 0006 — Decimation: min/max per pixel by default, LTTB for fixed budgets

- **Status:** Accepted
- **Date:** 2026-09-22
- **Principles:** P4, P5, P6, P8, P9

## Context

A 1,500 px wide chart can't show more than about 1,500 distinct x positions. Pushing 10M points to a Canvas
2D or SVG renderer costs time without adding anything visible. We need downsampling that is
(a) honest (no invented or hidden extremes, no bridged gaps), (b) fast enough to redo on zoom,
and (c) explainable.

## Decision

Two decimators in `@bicing/core`. Both take `(x, y, start, end, …)` over the visible slice and
return **indices** plus **segment starts** (`Decimated`):

|             | `minMaxPerPixel` (M4)                         | `lttb`                                         |
| ----------- | --------------------------------------------- | ---------------------------------------------- |
| Keeps       | first, min, max, last per pixel column        | one point per bucket, the largest triangle     |
| Output size | ≤ 4 × pixels (varies)                         | exactly `threshold` (no gaps)                  |
| Fidelity    | **pixel-exact** envelope when drawn as a line | shape-preserving, can drop a lone spike        |
| Use         | default for line rendering                    | fixed budgets: SVG baseline, tooltips, exports |

Gaps (steps > `maxGap`) always start a new segment, and both sides of a gap are always kept (P9).
The decimators return segment starts because, once zoomed out, kept points can legitimately be
further apart than `maxGap`, so a renderer can't re-detect gaps from the output.

**Measured** (Apple Silicon laptop, Node 24, 10M points, one series): min/max → 1,500 px in
~30 ms; LTTB → 3,000 points in ~26 ms. That's about 3 ns/point: linear, with no allocation beyond the
output.

**Consequence for zooming:** 30 ms is about two frames at 60 fps, so decimating _all_ visible points
on _every_ zoom frame is out of budget at 10M. The chart controller therefore:

1. draws the last decimated result through the current zoom transform during a gesture (cheap);
2. re-decimates the visible slice (found by binary search) once per rAF only when that slice
   is small enough to fit the frame budget, and otherwise when the gesture settles;
3. for WebGL, draws the full-resolution buffers already on the GPU (P6). Decimation there is
   optional, and the benchmark measures both.

Phase 2 adds precomputed aggregates (5 min / 1 h / 1 day) so the slice fed to the decimator stays
small at every zoom level, and moves decimation into a worker (P8).

## Consequences

- Positive: returning indices lets one decimation drive any column (bikes, docks, e-bikes) with no copies.
- Positive: property tests pin down the guarantees (sorted, endpoints kept, exact extremes per
  column for M4, exact size for LTTB, segments equal to source gaps). The tests were mutation-checked.
- Negative: min/max output size varies with the data, so buffers grow by doubling.
- Negative: LTTB with many gaps can exceed `threshold` (bound: `max(threshold, 2 × segments)`),
  because gap boundaries win over the budget.

## Alternatives considered

- **Uniform stride (every k-th point).** Trivial, but it hides peaks and aliases. That's dishonest by P9.
- **Only LTTB.** Fixed size is nice, but it isn't pixel-exact, and dropping a spike is exactly the kind of
  error a data-visualization portfolio shouldn't make.
- **Doing it in the GPU (a compute pass).** WebGL2 has no compute shaders. Not worth the complexity
  with the aggregate pyramid coming in Phase 2.
