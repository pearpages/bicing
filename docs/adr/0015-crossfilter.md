# 0015 — Crossfilter: incremental bitmasks in the data worker, small results to the page

- **Status:** Accepted
- **Date:** 2026-10-21
- **Principles:** P2, P4, P5, P6, P8, P9

## Context

Phase 3 links the views: brushing one filters the others (tasks.md T3.0–T3.7). It works over the raw readings a
view has loaded: synthetic data up to 10M rows, or a real month (~4.5M). The budget is no main-thread task over 50 ms
while brushing (architecture.md), and T3.2 asks for a brush update under 16 ms in the worker.

Each view needs, after every brush move:

- **Each histogram:** its counts under every filter **except its own** (crossfilter semantics), so a histogram still
  shows where its own brush could go.
- **The time series and the map:** which stations still have readings that pass every filter.

**Measured** (Node 24, Apple M4 Pro, median / p95 of 15–40 brush moves; four dimensions: time, hour of day,
occupancy, station). The full scan reads every row each move; the incremental version is described under Decision.

| Rows | Full scan, occupancy brush | Incremental, occupancy drag | Incremental, time drag | Incremental, worst jump |
| ---- | -------------------------- | --------------------------- | ---------------------- | ----------------------- |
| 4.5M | 20.9 / 26.2 ms             | **1.3 / 3.0 ms**            | **0.17 / 0.20 ms**     | 11.6 / 12.1 ms          |
| 10M  | 47.0 / 58.6 ms             | **3.4 / 6.0 ms**            | **0.39 / 0.43 ms**     | 26.8 / 27.1 ms          |

The incremental version needs indexes: 18 ms and 36 MB to build at 4.5M rows, 33 ms and 80 MB at 10M.

## Decision

(Accepted by the owner, 2026-10-21: the incremental mechanism, all four dimensions, and dimming whole stations.)

- **Dimensions:**
  - **time** (the chart's x brush);
  - **hour of day, in Barcelona time** (commuting is local: a DST offset table makes it one integer per row);
  - **occupancy**, bikes / capacity in 20 bins of 5%;
  - **station** (clicked on the map).

  Only in-service rows take part, the same rows the lines draw (P9).

- **Mechanism: incremental, as crossfilter.js does it.**
  - **Bitmask:** each row has a `Uint8` mask with one bit per dimension that filters it out. A row passes when
    its mask is 0. A histogram counts a row when its mask without the histogram's own bit is 0.
  - **Indexes:** binned dimensions keep their rows bucketed by bin (a counting sort, built once per load). A
    brush move toggles only the rows in bins that entered or left the range.
  - **Time:** rows are already sorted by `t`, so a time move toggles only the two runs at its ends.
  - **Counts:** histograms and per-station counts are updated by delta, so the cost follows what changed, not N.
- **Threads: the worker owns everything; the page gets small results.** The worker keeps per-row station, hour
  bin and occupancy bin (4 bytes a row), the mask (1) and the bin indexes (8), about 13 bytes a row: 58 MB for a
  month and 130 MB at 10M. Each update returns two histograms (44 counts) and the per-station counts (560). That's
  under 3 KB, cloned with `postMessage`, so the mask never needs to leave the worker. **No `SharedArrayBuffer`:**
  ADR 0005 kept it for this case, but the results turn out tiny.
- **One update in flight:** the page sends a brush position only when the previous answer has arrived. Positions in
  between collapse into the latest (the same "latest wins" rule as data loads).
- **What a selection looks like:**
  - histograms show the total in a faint bar, and what passes the other filters over it;
  - the time series and the map dim stations with no passing reading. Dimming is per station (per line), not per
    point, so the renderers only need a per-station flag.
- **Limits:** crossfilter works on raw readings up to 10M rows. The whole history's aggregate levels and the 50M
  stress tier hide the brushes.

## Consequences

- (+) Dragging a brush costs 1–7 ms in the worker at 10M rows, well inside a frame. Only a jump across a whole axis
  costs as much as a scan (27 ms at 10M), and that's once per gesture.
- (+) The page stays light: a few kilobytes per update and per-station flags. That keeps the main thread far below
  the 50 ms budget, and the renderers change only to dim lines.
- (+) The core pieces (bitmask toggles, bucket indexes, delta counts) are small pure functions, testable against a
  brute-force filter (T3.1, T3.2).
- (−) 13 bytes a row in the worker on top of the page's columns, and 18–33 ms of index building per load.
- (−) Station-level dimming can't show _when_ a station passed. A brushed time range is visible on the chart itself,
  but there's no per-point highlight.
- (−) More code than a full scan: three update paths (bins, time runs, station set) instead of one loop.

## Alternatives considered

- **Full scan per brush move:** one loop and no indexes, but 21 ms at 4.5M and 47 ms at 10M (measured), over T3.2's
  16 ms target. At 10M a fast drag would visibly lag.
- **A `SharedArrayBuffer` mask read by the renderers:** would allow per-point highlighting, but needs per-point
  colors in all three renderers, and synchronization between the worker and the page. The results the views need
  are a few kilobytes, so it buys nothing they use.
- **The `crossfilter2` library:** the same idea, but it's built around arrays of records (P4), and it runs where it's
  called rather than in our worker protocol.
- **DuckDB-WASM, re-querying per brush move:** still no stable release (ADR 0013), and a query per move costs more
  than a delta.
