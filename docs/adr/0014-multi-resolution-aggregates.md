# 0014 — Multi-resolution aggregates: raw, 1 hour and 1 day, drawn as min/max pairs

- **Status:** Accepted
- **Date:** 2026-10-21
- **Principles:** P1, P2, P6, P9, P24

## Context

The published history is 364M readings (T2.3). A month (~4.5M) draws at 60 fps, but a year (~55M) or the whole
history doesn't fit the budget, and fetching it would take minutes. T2.5 planned per-station min/max/mean at
5 min, 1 h and 1 day, picked by the visible span.

Measured on the published data (in-service rows, 2026-10-21):

| Level  | Rows        | vs raw       |
| ------ | ----------- | ------------ |
| raw    | 363,965,785 | —            |
| 5 min  | 353,426,723 | 3% smaller   |
| 1 hour | 30,689,062  | 12× smaller  |
| 1 day  | 1,297,334   | 280× smaller |

The feed already reports every ~5 minutes, so a 5-minute level would be the raw data again.

## Decision

(Chosen by the owner, 2026-10-21.)

- **Levels:** raw (the monthly files T2.3 already publishes), **1 hour** and **1 day**. There's no 5-minute level.
- **What a bucket holds:** per station and UTC bucket, over in-service readings only (the rows a line draws, P9):
  `min`, `max` and `mean` of the bikes available (`bikesMech + bikesElec`, capped at 255), and `count`, the number
  of readings behind it. Buckets are UTC, like the axis.
- **Files** (`tools/prepare-data`, sorted by (`t`, `stationIdx`), Snappy):
  - `agg-1d.parquet`, the whole history in one file (~1.3M rows);
  - `agg-1h-<YYYY>.parquet`, one per year (~4M rows), so a year view is one fetch.

  `manifest.json` lists them with their level.

- **Drawing:** a bucket becomes two points on its station's line, its min and its max. That's what min/max
  decimation already draws (ADR 0006): peaks survive, and nothing changes in the renderers. A missing bucket breaks
  the line, so the gap threshold for an aggregate level is one bucket. `mean` and `count` are for tooltips and the
  map (T2.7).
- **Split:** **T2.5a** builds and verifies the files. **T2.5b** makes the worker and the chart load the level the
  visible span needs, for the visible range, without resetting the zoom.

## Consequences

- (+) The whole history is 2.6M points and a year at 1 hour about 8M, both within what WebGL draws at 60 fps
  (README > Benchmarks).
- (+) No renderer work, and zoomed-out views look like the min/max decimation users already see.
- (+) `count` makes a thin bucket visible: an hour built from one reading isn't presented as a full hour.
- (−) UTC days run 01:00–01:00 or 02:00–02:00 in Barcelona. Local-time buckets would need the axis to change too;
  that's left for later.
- (−) Two more file families to build, host and keep in step with the raw files (they're built from them in the
  same publish step).

## Alternatives considered

- **5 min / 1 h / 1 day, as first planned:** the 5-minute level costs another ~350M rows to build and host for a
  3% saving.
- **Mean line with a min–max band:** reads as "typical level with a range", but needs a band renderer in all three
  technologies, and 560 overlapping bands are hard to read.
- **Decimating raw data in the worker for every view:** no new files, but a year means fetching and decoding ~55M
  rows first, which is the cost this task exists to avoid.
