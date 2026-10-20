# 0012 — Ingest: 7z-wasm extracts, DuckDB reads the CSVs, `last_reported` is the time

- **Status:** Accepted
- **Date:** 2026-10-20
- **Principles:** P2, P4, P9, P19, P24, P25

## Context

T2.2 assumed the monthly archives hold JSON snapshots. They don't (checked on 2019-03, 2022-06 and 2026-09):

- **Format:** each 7z holds **one CSV**, the GBFS feed flattened to one row per station per snapshot
  (`num_bikes_available_types.mechanical`, `last_reported`, `last_updated`, …).
- **Size:** a 2026 month is about 290 MB of status (4.5M rows, 545 stations, a snapshot every ~5 minutes) and
  990 MB of station information (the full station list repeated in every snapshot).
- **Drift:** the column order and the column set change between years. Individual rows can be shifted too: in
  2019-03 all 884 information rows of station 1 are off by one field, so `capacity` holds `1` while the station
  reports 30 bikes plus docks. Every other station that month, and every row in 2022-06 and 2026-09, lines up.
- **Stale reports:** stations in maintenance or planned repeat a months-old `last_reported` in every snapshot
  (22,916 rows in 2026-09).
- **Two timestamps:** `last_updated` is when the snapshot was taken, the same for every station.
  `last_reported` is when that station itself last reported, and it stays put while the station is silent.

**Tools available:** macOS ships `bsdtar` (libarchive), which reads 7z. CI (Ubuntu) has no guaranteed 7z tool.
`7zip-bin` was last released in 2022 and bundles an old 7-Zip. The archives are downloaded, so they're
untrusted input (security.md).

## Decision

- **Extraction: `7z-wasm` 1.2.0** (7-Zip 24.09 compiled to WASM, after the 24.07 decompression CVE fix). It
  runs in Node with only the archive's folder and a scratch folder under `data/` mounted, so the decompressor
  can't touch anything else. First we list the entries and require exactly one plain `*.csv` name (no `/`, no
  `..`), then we extract it.
  - Measured on 2026-09: under 1 s per archive and about 87 MB of memory, with output identical to `bsdtar`.
  - The extracted CSV is deleted once it's read.
- **Reading: DuckDB (`@duckdb/node-api` 1.5.6-r.1)** runs SQL over the CSV in Node:
  - columns are selected by header name, never by position;
  - values are cast with `TRY_CAST`, and any row that fails a cast or a range check is dropped and counted;
  - the run fails, naming the month, if more than 1% of rows fail, so a header that no longer matches its values
    stops the run instead of producing garbage.
- **Time is `last_reported`**, floored to the minute (minutes since 2018-01-01, as before).
  - Repeated snapshots of the same report collapse into one row per (station, `t`), keeping the latest snapshot.
  - Reports outside the archive's month (with a day of margin) are dropped and counted as **stale**, separately
    from invalid rows: they're silent stations, not broken data, so they don't count toward the 1% limit.
  - A silent station therefore produces a gap, never a stale value that looks fresh (P9).
- **Status:** `IN_SERVICE` → `InService`; `NOT_IN_SERVICE` and `MAINTENANCE` → `Closed`; anything else, such as
  `PLANNED`, → `Other`.
- **Stations:** the station information for a month is the latest snapshot of each station in that month.
  Station ids are mapped to dense indices `0..N-1` in ascending id order. A station present in the status file
  but missing from the information file still gets a row, named `#<id>` with no coordinates (NaN), and is
  counted in the report. T2.3 builds one mapping across all months for the merged file.
- **Capacity is checked against the readings.** Casts can't see a shifted row, but a station's capacity can't be
  below half the bikes plus free docks it reported. When it is, as with station 1 in 2019-03, or a station
  closed or shrunk during the month whose latest row says 0, its capacity becomes the most it reported, and it's
  counted in the report. If more than 10% of a month's stations need that, the information header itself is off
  and the month fails.

## Consequences

- (+) No system dependency: the same pinned extractor runs on macOS and in CI, and the fixture test runs everywhere.
- (+) A hostile archive can at worst fill the mounted scratch folder.
- (+) Header drift is handled by naming columns. A broken header fails loudly, and a single shifted station is
  repaired and reported instead of quietly getting a wrong capacity.
- (+) `last_reported` keeps the data honest: outages are gaps, and identical rows aren't stored twice.
- (−) Two new dependencies. DuckDB is a ~40 MB native binary per platform, prebuilt, with no install scripts.
- (−) `last_reported` timestamps are irregular, not a 5-minute grid. Aggregates (T2.5) bucket them anyway.
- (−) The capacity of a station repaired from its readings is a lower bound: the most bikes plus docks it
  reported, not a published figure.

## Alternatives considered

- **System `bsdtar` / `7z`:** no npm dependency and native speed, but it's an environment requirement. CI would
  need `libarchive-tools`, the version varies per machine, and native code reads untrusted archives without a
  sandbox. The WASM build turned out to be just as fast, so this saves nothing.
- **`7zip-bin`:** prebuilt binaries, but last released in 2022 with a 7-Zip that predates the 2024 fixes.
- **Streaming CSV parsing in TypeScript** (no DuckDB): fewer dependencies, but hand-written casting, joins and
  deduplication over 1.3 GB per month. DuckDB does it in a few lines of SQL that fit on a whiteboard (P2), and
  T2.3 needs it anyway to write Parquet.
- **`last_updated` as the time:** a regular grid and simpler, but a station that stops reporting would keep
  "reporting" its last numbers every 5 minutes, which hides outages.
