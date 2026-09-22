# 0009 — WebGL data lines without MSAA

- **Status:** Accepted
- **Date:** 2026-09-22
- **Principles:** P1, P5, P6

## Context

The first benchmark matrix (T1.15) missed the headline budget. WebGL2 at 10M points averaged 47 fps
over the scripted zoom and pan, with a 51 ms p95 and 12 frames over 50 ms, while the chart's own
CPU work was only 0.5 ms per frame. So the cost was on the GPU.

A harness rendered the same 10M-point line set repeatedly at a fixed view (Apple M4 Pro, Chrome 153,
1978×1056 CSS px):

| View                                  | MSAA    | dpr |   Frame p50 |   Frame p95 |
| ------------------------------------- | ------- | --- | ----------: | ----------: |
| Full extent (all 10M visible)         | on      | 2   |    100.0 ms |    100.9 ms |
| 5% zoom (~500k visible after culling) | on      | 2   |     16.7 ms |     17.5 ms |
| Full extent                           | **off** | 2   | **16.7 ms** | **17.7 ms** |
| Full extent                           | off     | 1   |     16.7 ms |     17.7 ms |

At full extent, each station contributes about 5 points per device pixel, so the GPU rasterizes millions of
sub-pixel segments. Multisampling multiplies that coverage and resolve work. The
backing-store size (dpr 1 vs 2) made no measurable difference. MSAA was the whole cost.

## Decision

`WebGLRenderer` creates its context with `antialias: false` by default, and `antialias` becomes an option.

## Consequences

- Positive: full-extent 10M frames go from about 10 fps to 60 fps on the reference machine.
- Negative: lines are aliased. At dpr 2 they're 1 device pixel wide and 35% opaque, and the
  difference is hard to see. On dpr 1 screens, stair-stepping is visible on slanted segments.
- The lesson for the README: "draw it on the GPU" isn't enough by itself. What the GPU is asked to do
  per pixel matters as much as the vertex count, and only a measurement showed it.

## Alternatives considered

- **Keep MSAA and reduce the vertex count when zoomed out** (min/max per pixel, or the Phase 2
  aggregates). Worth doing anyway, but per-series decimation barely helps here: 500 series × 4 ×
  ~4,000 device pixels is about 8M points, close to the input.
- **Antialias in the shader** (expanding lines into quads with feathered edges). Better-looking
  and usually cheaper than MSAA, but 4–6× the vertices and a new geometry path. A candidate for later.
- **MSAA only below a point threshold.** Context attributes are fixed at creation, so this would mean
  recreating the context when the dataset size changes. Possible later behind `createRenderer`.
