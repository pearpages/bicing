import {
  allocateAggregates,
  allocateObservations,
  Status,
  type AggregateColumns,
  type ObservationColumns,
  type TypedArray,
} from '@bicing/core';
import { tableFromIPC } from 'apache-arrow';

/**
 * Parquet bytes → Arrow IPC bytes. Injected, because the worker and Node load parquet-wasm
 * differently (ADR 0013); reading typed columns out of the IPC is the same everywhere.
 */
export type DecodeParquet = (bytes: Uint8Array) => Promise<Uint8Array>;

type TypedArrayConstructor =
  Uint8ArrayConstructor | Uint16ArrayConstructor | Uint32ArrayConstructor | Float32ArrayConstructor;

/** The compact types T2.3 writes for raw readings, and T2.5a for aggregate buckets (ADR 0014). */
export const RAW_SPEC = {
  stationIdx: Uint16Array,
  t: Uint32Array,
  bikesMech: Uint8Array,
  bikesElec: Uint8Array,
  docks: Uint8Array,
  status: Uint8Array,
} as const;

export const AGGREGATE_SPEC = {
  stationIdx: Uint16Array,
  t: Uint32Array,
  min: Uint8Array,
  max: Uint8Array,
  mean: Float32Array,
  count: Uint16Array,
} as const;

export type Columns<S extends Record<string, TypedArrayConstructor>> = {
  readonly [K in keyof S]: InstanceType<S[K]>;
};
export type DecodedColumns = Columns<typeof RAW_SPEC>;
export type DecodedAggregates = Columns<typeof AGGREGATE_SPEC>;

/**
 * Arrow hands back typed arrays, viewing its buffer when a column is a single batch. A column with
 * any other type means the file isn't ours: it's rejected (security.md).
 */
export function readColumns<S extends Record<string, TypedArrayConstructor>>(
  ipc: Uint8Array,
  spec: S,
  label: string,
): Columns<S> {
  const table = tableFromIPC(ipc);
  const columns: Record<string, unknown> = {};
  for (const [name, Type] of Object.entries(spec)) {
    const values: unknown = table.getChild(name)?.toArray();
    if (!(values instanceof Type))
      throw new Error(`${label}: column ${name} is missing or not ${Type.name}`);
    columns[name] = values;
  }
  return columns as Columns<S>;
}

const KNOWN_STATUS = new Set<number>(Object.values(Status));

/** Checks shared by every level: equal lengths, station indices in range, `t` sorted. */
function validateCommon(
  columns: Record<string, ArrayLike<number>> & { stationIdx: Uint16Array; t: Uint32Array },
  stationCount: number,
  label: string,
  row: (i: number) => void,
): void {
  const rows = columns.t.length;
  for (const values of Object.values(columns))
    if (values.length !== rows) throw new Error(`${label}: columns have different lengths`);
  let previous = 0;
  for (let i = 0; i < rows; i++) {
    const t = columns.t[i] as number;
    if (t < previous) throw new Error(`${label}: rows are not sorted by time at row ${String(i)}`);
    previous = t;
    if ((columns.stationIdx[i] as number) >= stationCount)
      throw new Error(`${label}: station index out of range at row ${String(i)}`);
    row(i);
  }
}

/** Fetched files are untrusted (security.md). One linear pass, in the worker (P8). */
export function validateColumns(columns: DecodedColumns, stationCount: number, label: string) {
  validateCommon(columns, stationCount, label, (i) => {
    if (!KNOWN_STATUS.has(columns.status[i] as number))
      throw new Error(`${label}: unknown status at row ${String(i)}`);
  });
}

export function validateAggregates(
  columns: DecodedAggregates,
  stationCount: number,
  label: string,
) {
  validateCommon(columns, stationCount, label, (i) => {
    if ((columns.min[i] as number) > (columns.max[i] as number))
      throw new Error(`${label}: min above max at row ${String(i)}`);
  });
}

/**
 * Parts in time order → one set of columns. Each part is sorted and they don't overlap, so the
 * result is sorted; overlapping parts are a bug upstream and fail loudly.
 */
function concat<N extends string>(
  names: readonly N[],
  parts: readonly (Readonly<Record<N, TypedArray>> & { readonly t: Uint32Array })[],
  out: Readonly<Record<N, TypedArray>>,
): void {
  let offset = 0;
  let previousLast = -1;
  for (const part of parts) {
    const first = part.t[0];
    if (first !== undefined && first < previousLast)
      throw new Error('parts overlap or are out of order');
    for (const name of names) out[name].set(part[name], offset);
    offset += part.t.length;
    previousLast = part.t[part.t.length - 1] ?? previousLast;
  }
}

const total = (parts: readonly { readonly t: Uint32Array }[]) =>
  parts.reduce((sum, part) => sum + part.t.length, 0);

export function concatMonths(parts: readonly DecodedColumns[]): ObservationColumns {
  const out = allocateObservations(total(parts));
  concat(Object.keys(RAW_SPEC) as (keyof typeof RAW_SPEC)[], parts, out);
  return out;
}

export function concatAggregates(parts: readonly DecodedAggregates[]): AggregateColumns {
  const out = allocateAggregates(total(parts));
  concat(Object.keys(AGGREGATE_SPEC) as (keyof typeof AGGREGATE_SPEC)[], parts, out);
  return out;
}
