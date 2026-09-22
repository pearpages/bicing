# Principles

Cite these by ID in commits, reviews and ADRs. If one gets in the way, amend it here first (in a `docs:` commit),
don't route around it.

## Purpose

- **P1 Serve the thesis.** Every feature must help show smooth rendering of millions of points with D3 math.
  If a feature doesn't, it waits.
- **P2 Explainable in an interview.** Prefer the solution you can explain on a whiteboard in two minutes over a cleverer one.

## Performance

- **P3 D3 computes, it doesn't draw data.** D3 modules for scales, axes, zoom, brush, color and format. Data marks go to
  Canvas/WebGL. SVG only for axes, overlays and the baseline. Import individual `d3-*` modules, never `d3`.
- **P4 Columnar, typed, contiguous.** Data lives in typed arrays. No arrays of objects on a hot path.
  Algorithms take `(columns, start, end)` and return indices, not copies.
- **P5 Measure, don't claim.** A performance claim needs a number from the benchmark harness, the machine it ran on,
  and the method. "Feels fast" isn't a result.
- **P6 Upload once, update cheaply.** Expensive work (GPU upload, indexing) happens when data changes. Per-frame
  work is limited to uniforms, transforms and the visible slice.
- **P7 One frame, one draw.** Updates are coalesced through rAF. Only dirty layers redraw.
- **P8 Never block the main thread with O(N) over the full dataset.** Full-dataset work runs in a worker, with buffers
  transferred, not cloned.
- **P9 Honest data.** Never interpolate across gaps. Decimation must keep extremes and gap boundaries.

## Architecture

- **P10 The dependency graph is law.** It's the one in ARCHITECTURE.md, enforced by lint. No exceptions.
- **P11 Frameworks are thin.** Vue owns layout and controls. Data and chart controllers are non-reactive (`markRaw`,
  `shallowRef`) and are driven through imperative methods.
- **P12 Pure core, effects at the edges.** `core` and `synthetic` are pure and DOM-free. Side effects live in workers,
  renderers and the app.
- **P13 Explicit public APIs.** Each package exports through its `index.ts` only. No deep imports, no re-exporting
  internals.

## Code

- **P14 Strict types.** `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`; no `any`, no
  non-null assertions (`!`). One narrow exception: a typed-array read whose index is bounded by the enclosing loop
  or by a binary search may be written `arr[i] as number`, because the checker can't see loop bounds. Anywhere
  else, handle `undefined` explicitly. The pattern stays greppable, and tests must cover the boundaries.
- **P15 Comments explain why.** If a comment says _what_, rename or restructure instead.
- **P16 Styles in stylesheets.** CSS Modules in `.module.scss` files. No inline styles, style objects or style bindings.
  (Canvas `width`/`height` attributes are backing-store sizing, not styling.)
- **P17 Small modules.** One concept per file. Split a file when it passes ~250 lines.

## Testing

- **P18 Every core algorithm is tested**, with examples _and_ fast-check properties, including empty input, a single
  point, fewer points than the target, all-equal values, and gaps.
- **P19 Deterministic by seed.** Synthetic data, tests and benchmarks are reproducible from a seed.
- **P20 Green before commit.** lint, typecheck and tests all pass (`pnpm test -- --run`, never watch mode).

## Process

- **P21 Work from TASKS.md.** Do the first unchecked task. Tick it in the same commit, and cite the task ID in the commit body.
- **P22 One logical change per commit**, with Conventional Commits.
- **P23 Decisions with trade-offs get an ADR** (`docs/adr/NNNN-title.md`: context, decision, consequences, alternatives).
- **P24 Say when the plan is wrong.** If a task or principle is impractical, stop, propose an amendment, and record it.
  Never work around it silently.
- **P25 Check versions, don't remember them.** Look up the current stable version before adding a dependency.
