import { join } from 'node:path';
import { Status } from '@bicing/core';
import type { DuckDBConnection } from '@duckdb/node-api';
import { sqlString } from './duckdb';
import { describe, type PublishedFile } from './published';

/**
 * ADR 0014's aggregate levels, built from the published monthly files in the same publish step, so
 * they can't drift from them. Per station and UTC bucket, over in-service readings (the rows a line
 * draws, P9): min, max and mean bikes, and how many readings the bucket holds.
 */

export const BUCKET_MINUTES = { '1h': 60, '1d': 1_440 } as const;

const list = (paths: readonly string[]) => `[${paths.map(sqlString).join(', ')}]`;

function bucketQuery(files: readonly string[], minutes: number): string {
  return `
    SELECT stationIdx, (t // ${String(minutes)} * ${String(minutes)})::UINTEGER AS t,
           min(bikes)::UTINYINT AS min, max(bikes)::UTINYINT AS max,
           avg(bikes)::FLOAT AS mean, count(*)::USMALLINT AS count
    FROM (
      SELECT stationIdx, t, least(bikesMech::INTEGER + bikesElec, 255) AS bikes
      FROM read_parquet(${list(files)})
      WHERE status = ${String(Status.InService)}
    )
    GROUP BY ALL
    ORDER BY t, stationIdx`;
}

/** `monthly` are the published `observations-<YYYY-MM>.parquet` paths, oldest first. */
export async function writeAggregates(
  connection: DuckDBConnection,
  outDir: string,
  monthly: readonly string[],
  log: (line: string) => void = () => undefined,
): Promise<PublishedFile[]> {
  const parquet = `(FORMAT parquet, COMPRESSION snappy)`;
  const written: PublishedFile[] = [];

  await connection.run(
    `COPY (${bucketQuery(monthly, BUCKET_MINUTES['1d'])}) TO ${sqlString(join(outDir, 'agg-1d.parquet'))} ${parquet}`,
  );
  written.push(await describe(connection, outDir, 'agg-1d.parquet', { level: '1d', month: null }));
  log(`published agg-1d.parquet (${String(written.at(-1)?.rows ?? 0)} rows)`);

  // One file per year: a year view is one fetch (ADR 0014).
  const byYear = new Map<string, string[]>();
  for (const path of monthly) {
    const year = /observations-(\d{4})-\d{2}\.parquet$/.exec(path)?.[1];
    if (year === undefined) throw new Error(`not a monthly file: ${path}`);
    byYear.set(year, [...(byYear.get(year) ?? []), path]);
  }
  for (const [year, files] of byYear) {
    const file = `agg-1h-${year}.parquet`;
    await connection.run(
      `COPY (${bucketQuery(files, BUCKET_MINUTES['1h'])}) TO ${sqlString(join(outDir, file))} ${parquet}`,
    );
    written.push(await describe(connection, outDir, file, { level: '1h', month: null }));
    log(`published ${file} (${String(written.at(-1)?.rows ?? 0)} rows)`);
  }
  return written;
}
