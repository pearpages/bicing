import initParquet, { readParquet } from 'parquet-wasm/esm';
// The WASM file is emitted as a separate asset and fetched by the worker only on the first load.
import wasmUrl from 'parquet-wasm/esm/parquet_wasm_bg.wasm?url';
import type { DecodeParquet } from './columns';

let ready: Promise<unknown> | null = null;

/** The worker's decoder (ADR 0013). Synthetic-only sessions never download the WASM. */
export const decodeInBrowser: DecodeParquet = async (bytes) => {
  ready ??= initParquet({ module_or_path: wasmUrl });
  await ready;
  return readParquet(bytes).intoIPCStream();
};
