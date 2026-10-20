import { DuckDBInstance, type DuckDBConnection, type DuckDBValue } from '@duckdb/node-api';

/** Small helpers over @duckdb/node-api shared by staging and publishing (ADR 0012). */

/** Opens an in-memory DuckDB for one job and always closes it. */
export async function withDuckDB<T>(job: (connection: DuckDBConnection) => Promise<T>): Promise<T> {
  const instance = await DuckDBInstance.create(':memory:');
  const connection = await instance.connect();
  try {
    return await job(connection);
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}

/** A SQL string literal. Paths are ours, but quoting them properly costs nothing. */
export function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export async function scalar(connection: DuckDBConnection, sql: string): Promise<number> {
  const reader = await connection.runAndReadAll(sql);
  const value = reader.getRows()[0]?.[0];
  return Number(value ?? 0);
}

/** A nullable numeric column: SQL NULL (and a missing cell) becomes `null`. */
export function asNumberOrNull(value: DuckDBValue | undefined): number | null {
  return value === null || value === undefined ? null : asNumber(value);
}

export function asNumber(value: DuckDBValue): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  throw new Error(`expected a number from DuckDB, got ${String(value)}`);
}
