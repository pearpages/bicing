import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_MAX_GAP_MINUTES } from '@bicing/core';
import type { DuckDBConnection } from '@duckdb/node-api';
import { writeAggregates } from './aggregates';
import { asNumber, asNumberOrNull, scalar, sqlString, withDuckDB } from './duckdb';
import { describe, type PublishedFile } from './published';
import { gapReport, monthsBetween, monthStart, type GapReport } from './gaps';

/**
 * Step 2 of `--build` (architecture.md > Ingest): staged months → the files the app loads, with
 * one station table, per-UTC-month files built from staged neighbours, a merged file and gaps.json.
 */

export type { PublishedFile } from './published';

export interface PublishSummary {
  readonly stations: number;
  readonly files: readonly PublishedFile[];
  readonly gaps: ReturnType<typeof gapReport>;
}

const COLUMNS = `stationIdx, t, bikesMech, bikesElec, docks, status`;
const PARQUET = `(FORMAT parquet, COMPRESSION snappy)`;

const list = (paths: readonly string[]) => `[${paths.map(sqlString).join(', ')}]`;

async function writeStations(
  connection: DuckDBConnection,
  stageDir: string,
  months: readonly string[],
  out: string,
) {
  // A station's row comes from the latest month it appears in; one that lost its information row
  // in a later month keeps an earlier one with a name (ADR 0012).
  const files = months.map((month) => join(stageDir, month, 'stations.parquet'));
  await connection.run(`
    CREATE TEMP TABLE all_stations AS
    SELECT station_id, name, lat, lon, capacity
    FROM read_parquet(${list(files)}, filename = true)
    QUALIFY row_number() OVER (
      PARTITION BY station_id ORDER BY name IS NULL, filename DESC
    ) = 1`);
  await connection.run(`
    CREATE TEMP TABLE station_index AS
    SELECT station_id, (row_number() OVER (ORDER BY station_id) - 1)::USMALLINT AS idx
    FROM all_stations`);
  const reader = await connection.runAndReadAll(`
    SELECT a.station_id, a.name, a.lat, a.lon, a.capacity
    FROM all_stations AS a JOIN station_index USING (station_id) ORDER BY idx`);
  const rows = reader.getRows();
  const json = {
    ids: rows.map(([id]) => String(id)),
    names: rows.map(([id, name]) => (typeof name === 'string' ? name : `#${String(id)}`)),
    lat: rows.map(([, , lat]) => asNumberOrNull(lat)),
    lon: rows.map(([, , , lon]) => asNumberOrNull(lon)),
    capacity: rows.map(([, , , , capacity]) => asNumberOrNull(capacity) ?? 0),
  };
  await writeFile(join(out, 'stations.json'), `${JSON.stringify(json)}\n`);
  return rows.length;
}

/** `staged` are the months in `stageDir`; `catalogue` is every month the catalogue lists. */
export async function publish(options: {
  readonly stageDir: string;
  readonly outDir: string;
  readonly staged: readonly string[];
  readonly catalogue: readonly string[];
  /** Catalogued months that couldn't be staged because their status archive is wrong (ADR 0012). */
  readonly unusable?: GapReport['unusableMonths'];
  readonly log?: (line: string) => void;
}): Promise<PublishSummary> {
  const { stageDir, outDir } = options;
  const log = options.log ?? (() => undefined);
  const staged = [...options.staged].sort();
  const first = staged[0];
  const last = staged.at(-1);
  if (first === undefined || last === undefined) throw new Error('nothing staged to publish');
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  return withDuckDB(async (connection) => {
    const stations = await writeStations(connection, stageDir, staged, outDir);
    const stagedSet = new Set(staged);
    const files: PublishedFile[] = [];

    // Every month from first to last, so a month without an archive (2025-11) still gets the rows
    // its neighbours' archives hold for it (they're cut by local time, not UTC).
    const months = monthsBetween(first, last);
    for (const [i, month] of months.entries()) {
      const sources = [months[i - 1], month, months[i + 1]]
        .filter((m): m is string => m !== undefined && stagedSet.has(m))
        .map((m) => join(stageDir, m, 'obs.parquet'));
      if (sources.length === 0) continue;
      const file = `observations-${month}.parquet`;
      const rows = await scalar(
        connection,
        `SELECT count(*) FROM read_parquet(${list(sources)})
         WHERE t >= ${String(monthStart(month))} AND t < ${String(monthStart(month, 1))}`,
      );
      if (rows === 0) continue;
      // The same report can sit in two neighbouring archives; keep it once.
      await connection.run(`
        COPY (
          SELECT idx AS stationIdx, t, bikes_mech AS bikesMech, bikes_elec AS bikesElec, docks, status
          FROM read_parquet(${list(sources)}) JOIN station_index USING (station_id)
          WHERE t >= ${String(monthStart(month))} AND t < ${String(monthStart(month, 1))}
          -- 108 of 364M reports differ between the two archives; a fixed order keeps builds
          -- reproducible (P19) instead of letting DuckDB pick either.
          QUALIFY row_number() OVER (
            PARTITION BY station_id, t ORDER BY status, bikes_mech, bikes_elec, docks
          ) = 1
          ORDER BY t, stationIdx
        ) TO ${sqlString(join(outDir, file))} ${PARQUET}`);
      files.push(await describe(connection, outDir, file, { level: 'raw', month }));
      log(`published ${file} (${String(files.at(-1)?.rows ?? 0)} rows)`);
    }

    // Months are disjoint and each is sorted, so reading them in order is already sorted.
    const monthly = files.map((f) => join(outDir, f.file));
    await connection.run(
      `COPY (SELECT ${COLUMNS} FROM read_parquet(${list(monthly)})) TO ${sqlString(join(outDir, 'observations.parquet'))} ${PARQUET}`,
    );
    files.push(
      await describe(connection, outDir, 'observations.parquet', { level: 'raw', month: null }),
    );
    files.push(...(await writeAggregates(connection, outDir, monthly, log)));

    // Coverage is the whole catalogue, so an unusable month at either end still counts as silence.
    const catalogue = [...new Set([...options.catalogue, ...staged])].sort();
    const coverageFrom = monthStart(catalogue[0] ?? first);
    const coverageTo = monthStart(catalogue.at(-1) ?? last, 1);
    const snapshotFiles = staged.map((m) => join(stageDir, m, 'snapshots.parquet'));
    const reader = await connection.runAndReadAll(
      `SELECT DISTINCT t FROM read_parquet(${list(snapshotFiles)})
       WHERE t >= ${String(coverageFrom)} AND t < ${String(coverageTo)} ORDER BY t`,
    );
    const snapshots = Uint32Array.from(reader.getRows(), ([t]) => asNumber(t ?? 0));
    const gaps = gapReport(snapshots, catalogue, DEFAULT_MAX_GAP_MINUTES, options.unusable ?? []);
    await writeFile(join(outDir, 'gaps.json'), `${JSON.stringify(gaps, null, 2)}\n`);
    await writeFile(
      join(outDir, 'manifest.json'),
      `${JSON.stringify({ format: 'bicing-pulse/parquet@1', columns: COLUMNS.split(', '), stations, files }, null, 2)}\n`,
    );
    return { stations, files, gaps };
  });
}
