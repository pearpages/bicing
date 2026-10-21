import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { DuckDBConnection } from '@duckdb/node-api';
import { asNumberOrNull, sqlString } from './duckdb';

/** Raw readings, or one of ADR 0014's aggregate levels. */
export type Level = 'raw' | '1h' | '1d';

/** One entry of `manifest.json`: what the browser needs to pick and fetch a file (T2.4, T2.5b). */
export interface PublishedFile {
  readonly file: string;
  readonly level: Level;
  /** The UTC month of a monthly raw file; `null` for the merged file and the aggregates. */
  readonly month: string | null;
  readonly rows: number;
  readonly bytes: number;
  readonly t0: number | null;
  readonly t1: number | null;
}

/** Reads back a written file's row count and time range, so the manifest describes what's on disk. */
export async function describe(
  connection: DuckDBConnection,
  out: string,
  file: string,
  meta: Pick<PublishedFile, 'level' | 'month'>,
): Promise<PublishedFile> {
  const path = join(out, file);
  const reader = await connection.runAndReadAll(
    `SELECT count(*), min(t), max(t) FROM read_parquet(${sqlString(path)})`,
  );
  const [rows, t0, t1] = reader.getRows()[0] ?? [];
  return {
    file,
    ...meta,
    rows: Number(rows ?? 0),
    bytes: (await stat(path)).size,
    t0: asNumberOrNull(t0),
    t1: asNumberOrNull(t1),
  };
}
