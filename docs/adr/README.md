# Architecture Decision Records

One file per decision that has trade-offs (P23). Format: **Context → Decision → Consequences →
Alternatives considered**. ADRs are append-only: to change a decision, write a new ADR that
supersedes the old one, and mark the old one `Superseded by NNNN`.

| #                                           | Title                                                            | Status   |
| ------------------------------------------- | ---------------------------------------------------------------- | -------- |
| [0001](0001-canvas-webgl-for-data-marks.md) | Canvas 2D / WebGL2 for data marks, not SVG                       | Accepted |
| [0002](0002-typescript-6-pin.md)            | Pin TypeScript 6.0 instead of 7.0                                | Accepted |
| [0003](0003-synthetic-package.md)           | The synthetic generator is a package, not only a tool            | Accepted |
| [0005](0005-handwritten-worker-protocol.md) | A hand-written, typed worker protocol instead of Comlink         | Accepted |
| [0006](0006-decimation-strategy.md)         | Decimation: min/max per pixel by default, LTTB for fixed budgets | Accepted |
