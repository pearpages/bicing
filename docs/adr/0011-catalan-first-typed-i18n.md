# 0011 — Catalan-first UI with typed dictionaries, no i18n library

- **Status:** Accepted
- **Date:** 2026-09-28
- **Principles:** P1, P2, P11, P14, P27

## Context

The demo will be served at `bicing.soms.cat`, a Catalan domain, about Barcelona's bike-sharing system. Its main
language must be Catalan, with English as the second language. Until now every user-facing string was English and
hardcoded, and so were the formats: `Intl.NumberFormat('en')` in the app, and the chart's `utcFormat` tooltip and
d3's default axis ticks (English month and weekday names).

The copy is small: roughly 80 strings across the controls, the perf panel, the legend, the results dialog and the
chart (tooltip, cap message, accessible label). There are two languages and no plural rule beyond "1 vs many".

The repository's own docs (README, ADRs, principles…) stay in English: the project is also a portfolio piece read by
international reviewers.

## Decision

- **Languages:** `ca` (default and source of truth) and `en`. Resolution order: `?lang=` in the URL, then the
  remembered choice (localStorage, wrapped in try/catch), then `ca`. The browser language is deliberately ignored, so
  the site is Catalan unless the visitor asks otherwise. `?lang=en` gives a shareable English link.
- **Dictionaries, not a library:** `apps/web/src/i18n/messages.ca.ts` defines the messages object, and its type is
  `Messages`. `messages.en.ts` is declared as `Messages`, so a missing or extra key fails typecheck (P14).
  Interpolated messages are functions (`capped: (max, requested) => …`). Components read typed properties
  (`t.value.controls.renderer`), never string keys.
- **Formats come from the locale:** numbers use `Intl.NumberFormat(locale)`. Dates use `d3-time-format`'s
  `timeFormatLocale` with its bundled `ca-ES` / `en-GB` definitions, for both axis ticks and tooltips.
- **Charts stay framework-agnostic and dictionary-free:** `TimeSeriesChart` takes a `ChartLocale` option (a time
  format locale, a number formatter and its few strings), and `setLocale()` marks the axes and overlay dirty. The app
  builds the `ChartLocale` from the active dictionary. `@bicing/charts` never imports app messages (P10).
- **The language is a setting:** it's a reactive ref owned by Vue (ADR 0007). Changing it re-renders the copy, and
  reaches charts only through `setLocale()`.
- **Static HTML is Catalan:** `index.html` has `lang="ca"` and a Catalan title and description, so crawlers and link
  previews see Catalan. The app then updates `<html lang>`, the title and the description when the language changes.
- **Developer-facing text stays English:** thrown errors, console messages and code comments.

## Consequences

- (+) Zero dependencies. Translation completeness is checked by the compiler, not at runtime.
- (+) The implementation is a whiteboard sketch: two objects, one type, one composable (P2).
- (+) Axes, tooltips and numbers switch language along with the copy (`1.000.000`, `dl. 22 set.`).
- (−) There's no ICU message syntax. Plurals and interpolation are hand-written functions, which is fine at this size.
- (−) Link previews and crawlers see only Catalan, because English exists only client-side.
- (−) Every new component must take its copy from the dictionary (P27, checked in review).

## Alternatives considered

- **vue-i18n 11:** the standard choice, with message syntax and pluralization. It adds bundle weight and runtime
  message compilation for ~80 strings. String keys are weakly typed unless extra schema typing is set up, and the chart
  package would still need its own locale injection.
- **Follow the browser language:** friendlier to foreign visitors, but the site wouldn't be Catalan-first on its
  Catalan domain.
- **Separate `/en/` builds:** English crawlable and previewable, but it doubles the deploy and routing for a
  single-page demo. Worth revisiting only if English previews start to matter.
