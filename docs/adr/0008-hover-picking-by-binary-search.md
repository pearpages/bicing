# 0008 — Time-series hover by per-series binary search, not a spatial index

- **Status:** Accepted
- **Date:** 2026-09-22
- **Principles:** P2, P6, P9, P24

## Context

The brief asks for "hover picking through a spatial index rather than scanning every point", and
suggests flatbush or d3-quadtree. For the time series, the hover question is: _at the pointer's time,
which station's line is closest in y?_ A 2D index over the drawn vertices would need rebuilding in
pixel space whenever the view changes, an O(n log n) build over up to millions of visible points
on every zoom. Building it in data space instead distorts distances, because x (minutes) and y (bikes)
have unrelated units, and zooming changes their ratio.

## Decision

`pickAt(series, t, y, maxYDistance)` in `@bicing/charts`:

- For each station, binary-search its time-sorted slice for `t` and take the nearer neighbor:
  **O(stations × log n)**. That's about 7,500 steps for 500 stations × 20k samples, far below 1 ms, and
  it needs no index, so nothing is rebuilt when the view changes.
- Exact on full-resolution data, whether or not the renderer is drawing a decimated version.
- A station counts only if its nearest sample is within `maxGap / 2`. **Hover never picks inside a
  gap** (a closure or a missing day), consistent with drawing (P9).
- Within a 24 px vertical radius the closest station wins. Ties go to the lower index (deterministic).
- Hover is off during gestures. The overlay (a dashed crosshair, an 8 px marker with a 2 px surface
  ring, and a tooltip) is SVG positioned with attributes, and the app supplies the text through `describe(hit)`.

Flatbush moves to the **Phase 2 map view**. There the points (stations) are really scattered in 2D
and static, so the index is built once and queried per move.

## Consequences

- Positive: simpler, exact, and cheap, and each part is easy to explain.
- Positive: `pickAt` is a pure function with tests (nearest line, snap to nearest sample, gaps
  never picked, empty input, ties).
- Negative: picking considers only the pointer's time column. A line that's steep and close in 2D but
  not at that exact time loses to one that's near in y. That's the standard line-chart crosshair behavior.

## Alternatives considered

- **Flatbush over drawn vertices in pixel space.** Rebuild cost on every zoom, and memory for up to
  millions of boxes.
- **d3-quadtree in data space with scaled distances.** Still needs rebuilding or anisotropic queries,
  and it isn't exact at the zoom levels where it matters.
- **GPU color picking** (render line ids to an offscreen buffer). Pixel-exact, but it needs a second
  render pass and a GPU readback per move, which is a lot of machinery for a crosshair.
