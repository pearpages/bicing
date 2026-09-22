# 0005 — A hand-written, typed worker protocol instead of Comlink

- **Status:** Accepted
- **Date:** 2026-09-22
- **Principles:** P2, P8, P12

## Context

Full-dataset work (generation now; Parquet decoding, aggregates and crossfilter bitsets later)
must run off the main thread (P8), and results measured in hundreds of MB must cross the thread
boundary without being copied. Comlink turns a worker into an async RPC proxy. It's pleasant, but
it hides `postMessage`, and zero-copy needs an easy-to-forget `Comlink.transfer(value, [buffers])` wrapper.

## Decision

A small, explicit protocol in `@bicing/data`:

- `protocol.ts`: `WorkerRequest` / `WorkerResponse` discriminated unions, each carrying an `id`,
  plus `transferList()`, which collects every distinct `ArrayBuffer` in a dataset.
- `handler.ts`: `handleRequest(request) → { response, transfer }`, a plain function that is
  unit-tested in Node without a worker.
- `data.worker.ts`: a 5-line entry point: `postMessage(response, { transfer })`.
- `client.ts`: a promise-based client with request ids, out-of-order responses, error
  propagation, crash handling and `dispose()`.
- `worker.ts`: `createDataWorker()` keeps the `new URL('./data.worker.ts', import.meta.url)`
  pattern inside the package, so Vite resolves it relative to the worker source.

The detach semantics are tested directly. `structuredClone(response, { transfer })` behaves
like `postMessage`: after it, the sender's column views have `byteLength === 0`, and the receiver has
the data.

## Consequences

- Positive: zero-copy is visible in the code and enforced by a test, not by convention.
- Positive: the worker logic is testable without a browser.
- Positive: no dependency, and about 150 lines in total.
- Negative: each new request type needs a union member plus a handler branch (Comlink would be
  one method). Acceptable at this scale; revisit if the protocol grows past ~6 messages.
- Negative: after transfer, the worker keeps no copy. Anything it needs again must be
  regenerated or sent back. Phase 3's crossfilter will keep its own columns in the worker for that reason.

## Alternatives considered

- **Comlink.** Less code, but the transfer lists are opt-in and easy to forget, and the magic
  is harder to explain in an interview (P2).
- **SharedArrayBuffer.** Real sharing instead of moving, and the COOP/COEP headers already allow it.
  Kept for Phase 3 (bitsets written by the worker and read by renderers), where concurrent access pays
  for the synchronization complexity.
