# 0007 — Vue owns settings, never data

- **Status:** Accepted
- **Date:** 2026-09-22
- **Principles:** P6, P11, P13

## Context

The brief was written for React ("React must never re-render because data changed"). The project uses
Vue 3 at the owner's request. Vue has a different, subtler failure mode than React re-renders:
**deep reactivity**. `ref(x)` or `reactive(x)` wraps `x` in a Proxy, recursively. Vue skips typed
arrays themselves, but the `StationSeries` object that _holds_ them gets proxied. Every `series.x` or
`series.y` read in a hot loop (decimation, picking) then goes through a Proxy `get` trap, and deep
watchers would try to traverse millions of values.

## Decision

- `@bicing/vue` is thin: a `useTimeSeriesChart(host, options)` composable and a `<TimeSeriesChart>`
  component (props: `series`, `renderer`, `decimation`, `colorScale`, `alpha`, `describe`; events:
  `frame`, `hover`, `view`; it exposes `chart` for imperative calls such as the scripted benchmark).
- The controller is `markRaw`ed and held in a `shallowRef`. Vue never makes it reactive.
- The series is `toRaw`ed before it reaches the chart, so even a parent that mistakenly used a deep
  `ref()` hands the chart plain objects. **A test asserts `isProxy(data) === false` in that case.**
- Watches are shallow. New data means a new object identity (the worker sends a new one each time),
  not a mutation. A test asserts that mutating inside the series doesn't re-send it.
- Settings (renderer kind, decimation, color scale) are the only reactive inputs, applied through
  imperative controller methods.
- The package graph allows `vue → charts`, not `vue → renderers`, so renderers are chosen by kind
  through `createRenderer()` from `@bicing/charts`.
- Styles: the component imports `@bicing/charts/styles.css`, and its own host sizing is a CSS Module (P16).

## Consequences

- Positive: frame-rate work never touches Vue's reactivity, and there are no per-frame Vue re-renders
  unless the app opts in (e.g. the perf overlay, which should throttle).
- Positive: the same controller works under any framework, and the bindings stay under ~100 lines.
- Negative: data changes must replace the object (immutable by convention). Mutating a series in place
  isn't observed, by design.
- Negative: app code has to use `shallowRef` for datasets. The `toRaw` guard catches mistakes at the
  boundary, but the parent's own code would still pay for its deep ref.

## Alternatives considered

- **Pass data through reactive props and rely on Vue's diffing.** That's the failure mode described above.
- **A custom renderer that renders charts with Vue's virtual DOM.** It ties the drawing to the component tree,
  which is the opposite of P11.
