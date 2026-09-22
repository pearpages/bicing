# 0002 — Pin TypeScript 6.0 instead of 7.0

- **Status:** Accepted
- **Date:** 2026-09-21
- **Principles:** P14, P25

## Context

The latest TypeScript on npm is 7.0.2, the native (Go) compiler. The lint setup relies on
type-aware rules from `typescript-eslint` (`strictTypeChecked`: no-unsafe-*, no-floating-promises,
etc.). `typescript-eslint@8.70.0` declares `typescript >=4.8.4 <6.1.0` as a peer dependency, and
typed linting uses the compiler API that TS 7 does not yet provide in the same form.

## Decision

Pin **TypeScript 6.0.3** in every package. `vue-tsc@3.3.11` (peer `typescript >=5.0.0`) typechecks
`.vue` files on the same compiler.

## Consequences

- Positive: type-aware lint rules stay on, and they catch real bugs in async and worker code.
- Negative: we miss TS 7's much faster type checking. At this project's size, that doesn't matter.
- Revisit when `typescript-eslint` supports TS 7. The native preview (`tsgo`) could be added as a
  fast typecheck-only step before then, if the checks ever get slow.

## Alternatives considered

- **TS 7 + untyped lint.** We'd lose the rules that matter most for worker/async correctness.
- **TS 7 for `tsc`, TS 6 for lint.** Two compilers could disagree on types. Not worth it.
