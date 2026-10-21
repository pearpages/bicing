import { allocateObservations, Status, type ObservationColumns } from '@bicing/core';
import { tableFromIPC } from 'apache-arrow';

/** One Parquet file's columns, already in the compact types T2.3 writes (ADR 0013). */
export interface DecodedColumns {
  readonly stationIdx: Uint16Array;
  readonly t: Uint32Array;
  readonly bikesMech: Uint8Array;
  readonly bikesElec: Uint8Array;
  readonly docks: Uint8Array;
  readonly status: Uint8Array;
}

/** Parquet bytes → columns. Injected, because the worker and Node load parquet-wasm differently. */
export type DecodeParquet = (bytes: Uint8Array) => Promise<DecodedColumns>;

const EXPECTED = {
  stationIdx: Uint16Array,
  t: Uint32Array,
  bikesMech: Uint8Array,
  bikesElec: Uint8Array,
  docks: Uint8Array,
  status: Uint8Array,
} as const;
type ColumnName = keyof typeof EXPECTED;
const NAMES = Object.keys(EXPECTED) as ColumnName[];

/**
 * parquet-wasm returns Arrow IPC; Arrow hands back typed arrays, viewing its buffer when a column
 * is a single batch. A column with any other type means the file isn't ours: it's rejected.
 */
export function columnsFromArrowIpc(ipc: Uint8Array, label: string): DecodedColumns {
  const table = tableFromIPC(ipc);
  const read = <K extends ColumnName>(name: K): InstanceType<(typeof EXPECTED)[K]> => {
    const values: unknown = table.getChild(name)?.toArray();
    if (!(values instanceof EXPECTED[name]))
      throw new Error(`${label}: column ${name} is missing or not ${EXPECTED[name].name}`);
    return values as InstanceType<(typeof EXPECTED)[K]>;
  };
  return {
    stationIdx: read('stationIdx'),
    t: read('t'),
    bikesMech: read('bikesMech'),
    bikesElec: read('bikesElec'),
    docks: read('docks'),
    status: read('status'),
  };
}

const KNOWN_STATUS = new Set<number>(Object.values(Status));

/**
 * Fetched files are untrusted (security.md): equal column lengths, every station index inside the
 * station table, `t` sorted, a known status. One linear pass, in the worker (P8).
 */
export function validateColumns(
  columns: DecodedColumns,
  stationCount: number,
  label: string,
): void {
  const rows = columns.t.length;
  for (const name of NAMES)
    if (columns[name].length !== rows) throw new Error(`${label}: columns have different lengths`);
  let previous = 0;
  for (let i = 0; i < rows; i++) {
    const t = columns.t[i] as number;
    if (t < previous) throw new Error(`${label}: rows are not sorted by time at row ${String(i)}`);
    previous = t;
    if ((columns.stationIdx[i] as number) >= stationCount)
      throw new Error(`${label}: station index out of range at row ${String(i)}`);
    if (!KNOWN_STATUS.has(columns.status[i] as number))
      throw new Error(`${label}: unknown status at row ${String(i)}`);
  }
}

/** Months in order → one store. Each month is sorted and they don't overlap, so the result is sorted. */
export function concatMonths(parts: readonly DecodedColumns[]): ObservationColumns {
  const length = parts.reduce((sum, part) => sum + part.t.length, 0);
  const out = allocateObservations(length);
  let offset = 0;
  let previousLast = -1;
  for (const part of parts) {
    const first = part.t[0];
    if (first !== undefined && first < previousLast)
      throw new Error('months overlap or are out of order');
    for (const name of NAMES) out[name].set(part[name], offset);
    offset += part.t.length;
    previousLast = part.t[part.t.length - 1] ?? previousLast;
  }
  return out;
}
