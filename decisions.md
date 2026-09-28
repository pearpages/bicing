# Decisions

Architecture Decision Records for Bicing Pulse. Each ADR in `docs/adr/` records one choice with trade-offs (P23): its
context, the decision, its consequences and the alternatives considered. The rules that follow from them are in
[principles.md](principles.md); how the result is built is in [architecture.md](architecture.md).

New ADR: copy the format below, take the next number, and add a line here. ADRs are append-only: reversing one means a
new ADR that supersedes it, and the old one's status becomes `Superseded by NNNN`. ADRs are proposed to the owner
before they are accepted.

| #                                                       | Decision                                                                           | Status   | Date       |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------- | ---------- |
| [0001](docs/adr/0001-canvas-webgl-for-data-marks.md)    | Canvas 2D / WebGL2 for data marks, not SVG                                         | Accepted | 2026-09-21 |
| [0002](docs/adr/0002-typescript-6-pin.md)               | Pin TypeScript 6.0 instead of 7.0                                                  | Accepted | 2026-09-21 |
| [0003](docs/adr/0003-synthetic-package.md)              | The synthetic generator is a package, not only a tool                              | Accepted | 2026-09-22 |
| [0004](docs/adr/0004-renderer-interface-upload-once.md) | One Renderer interface; expensive work in setData, cheap work in render            | Accepted | 2026-09-22 |
| [0005](docs/adr/0005-handwritten-worker-protocol.md)    | A hand-written, typed worker protocol instead of Comlink                           | Accepted | 2026-09-22 |
| [0006](docs/adr/0006-decimation-strategy.md)            | Decimation: min/max per pixel by default, LTTB for fixed budgets                   | Accepted | 2026-09-22 |
| [0007](docs/adr/0007-vue-non-reactive-data.md)          | Vue owns settings, never data                                                      | Accepted | 2026-09-22 |
| [0008](docs/adr/0008-hover-picking-by-binary-search.md) | Time-series hover by per-series binary search, not a spatial index                 | Accepted | 2026-09-22 |
| [0009](docs/adr/0009-webgl-lines-without-msaa.md)       | WebGL data lines without MSAA                                                      | Accepted | 2026-09-22 |
| [0010](docs/adr/0010-project-knowledge-files.md)        | Project knowledge lives in principles, architecture, decisions, tasks and security | Accepted | 2026-09-26 |
| [0011](docs/adr/0011-catalan-first-typed-i18n.md)       | Catalan-first UI with typed dictionaries, no i18n library                          | Accepted | 2026-09-28 |

## Format

```md
# NNNN — Title

- **Status:** Proposed | Accepted | Superseded by NNNN
- **Date:** YYYY-MM-DD
- **Principles:** P…

## Context

What forces the choice.

## Decision

What we do.

## Consequences

What gets better (+) and what it costs (−).

## Alternatives considered

What else was on the table, and why it lost.
```
