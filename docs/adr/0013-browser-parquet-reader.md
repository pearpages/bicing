# 0013 — The browser reads Parquet with parquet-wasm, in the data worker

- **Status:** Accepted
- **Date:** 2026-10-20
- **Principles:** P2, P5, P6, P8, P25

## Context

T2.3 publishes the history as one Parquet file per UTC month (about 4.5M rows and 12.6 MB for a 2026 month,
Snappy, row groups of 122,880 rows), plus `stations.json`, `gaps.json` and `manifest.json`. The app must load
months in the data worker and hand the columns to the main thread the way synthetic data already arrives: typed
arrays, transferred, never cloned (ADR 0005).

The candidates (versions checked 2026-10-20, P25):

- **hyparquet 1.31.5:** pure JavaScript, no dependencies, ~43 KB gzipped, range requests built in.
- **parquet-wasm 0.9.0:** Rust compiled to WASM, returns Arrow IPC. With `apache-arrow` 21.2.0 that gives typed
  arrays. The full build is ~1.6 MB gzipped; a custom Snappy-only reader build would be under ~500 KB but needs a
  Rust toolchain.
- **DuckDB-WASM:** still only dev builds (`latest` is 1.33.1-dev57.0), ~150 MB unpacked.

**Measured** (Node 24, Apple M4 Pro, best of 5): both readers decode `observations-2026-09.parquet` (4,455,264
rows) into the app's six typed arrays, and their outputs are identical.

| Reader       | Decode     | Output                                                |
| ------------ | ---------- | ----------------------------------------------------- |
| hyparquet    | 484 ms     | JS `Array`s, copied into typed arrays                 |
| parquet-wasm | **107 ms** | `Uint16Array` / `Uint32Array` / `Uint8Array` directly |

A year of data is about 5.8 s of decoding with hyparquet and about 1.3 s with parquet-wasm.

## Decision

**parquet-wasm + apache-arrow, in the data worker** (chosen by the owner, 2026-10-20).

- **Loading:** the worker gets a new `load` request (`baseUrl`, `months`). It fetches `stations.json` and each
  `observations-<YYYY-MM>.parquet`, decodes them, and concatenates the months into one `ObservationColumns`. Then
  it builds the station series and transfers every buffer, exactly like `generate`. The main thread never parses
  Parquet (P8).
- **Lazy WASM:** the WASM module is initialised in the worker on the first `load` only, so synthetic mode and the
  main bundle don't pay for it.
- **Testable:** the decoder is injected. The worker uses `parquet-wasm/esm` with the WASM file as a Vite asset;
  tests use `parquet-wasm/node`.
- **Fetched data is untrusted** (security.md):
  - the month names come from `manifest.json` and must match `YYYY-MM` before they're put in a URL;
  - the station table must have consistent lengths;
  - every `stationIdx` must be below the station count, `t` must be sorted, and `status` must be a known value;
  - a file that fails any of these is rejected, never drawn.
- **Configurable base URL:** `VITE_DATA_BASE_URL` sets it at build time (default `/data/`). In development and
  `vite preview`, a small Vite plugin serves `data/parquet` at `/data/`, with range requests. In production the
  files live on an external host that must send CORS headers (COEP is `credentialless`) and support range
  requests (A9 picks the host).
- **Whole files for now:** a month is fetched in one request. Range requests come with T2.5, which reads only the
  columns and row groups a view needs, through `ParquetFile.fromUrl`.

## Consequences

- (+) 4.5× faster decoding, which is what a performance thesis should show, and typed arrays without a per-value
  copy.
- (+) The same transfer protocol as synthetic data, so the charts don't know where the data came from.
- (−) A ~1.6 MB gzipped WASM download, paid once (cached) and only when real data is loaded. A Snappy-only custom
  build is the way to shrink it if it ever matters for time to first chart (T2.8 will measure it).
- (−) Two runtime dependencies, both maintained (parquet-wasm 2026-09, apache-arrow 2026-07).
- (−) Node and browser load the module differently, which is why the decoder is injected.

## Alternatives considered

- **hyparquet:** tiny and simplest to explain, but 4.5× slower, and its JS arrays mean an extra copy and a memory
  spike per load. It would be the pick if bundle size mattered more than decoding speed.
- **DuckDB-WASM:** SQL in the browser would be pleasant for Phase 3, but there are no stable releases and it's two
  orders of magnitude bigger.
- **Converting to raw column files** (as `tools/synthetic` writes): fastest to load, but no compression (a month
  is ~40 MB instead of 12.6 MB) and no metadata. Parquet is the format the task and the T2.5 range reads need.
