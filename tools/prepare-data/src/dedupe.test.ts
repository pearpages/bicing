import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toMinutes } from '@bicing/core';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { asNumber, sqlString, withDuckDB } from './duckdb';
import { publish } from './publish';

/**
 * A report that sits in two neighbouring archives with different values (108 of them in the real
 * history) must resolve the same way every build (P19).
 */

const T = toMinutes(Date.UTC(2026, 7, 1, 0, 10));
let dir: string;

/** Writes one hand-made staged month: obs rows are [station_id, t, mech, elec, docks, status]. */
async function stage(month: string, obs: readonly (readonly number[])[]) {
  const target = join(dir, 'stage', month);
  await mkdir(target, { recursive: true });
  const values = obs.map((row) => `(${row.join(', ')})`).join(', ');
  await withDuckDB(async (connection) => {
    const out = (file: string) => `${sqlString(join(target, file))} (FORMAT parquet)`;
    await connection.run(`COPY (
      SELECT c0::UINTEGER AS station_id, c1::UINTEGER AS t, c2::UTINYINT AS bikes_mech,
             c3::UTINYINT AS bikes_elec, c4::UTINYINT AS docks, c5::UTINYINT AS status
      FROM (VALUES ${values}) AS v(c0, c1, c2, c3, c4, c5)) TO ${out('obs.parquet')}`);
    await connection.run(`COPY (
      SELECT 1::UINTEGER AS station_id, 'GRAN VIA' AS name, 41.39::DOUBLE AS lat,
             2.18::DOUBLE AS lon, 20::UTINYINT AS capacity) TO ${out('stations.parquet')}`);
    await connection.run(
      `COPY (SELECT ${String(T)}::UINTEGER AS t) TO ${out('snapshots.parquet')}`,
    );
  });
}

async function publishedRows(out: string): Promise<number[][]> {
  await publish({
    stageDir: join(dir, 'stage'),
    outDir: join(dir, out),
    staged: ['2026-07', '2026-08'],
    catalogue: ['2026-07', '2026-08'],
  });
  return withDuckDB(async (connection) => {
    const path = sqlString(join(dir, out, 'observations-2026-08.parquet'));
    const reader = await connection.runAndReadAll(
      `SELECT stationIdx, t, bikesMech, docks, status FROM read_parquet(${path})`,
    );
    return reader.getRows().map((row) => row.map((v) => asNumber(v ?? 0)));
  });
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'prepare-dedupe-'));
  // July's archive (local time) already holds the report of 00:10 UTC on 1 August, with other values.
  await stage('2026-07', [[1, T, 9, 0, 11, 0]]);
  await stage('2026-08', [
    [1, T, 3, 0, 17, 0],
    [1, T + 5, 4, 0, 16, 0],
  ]);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('deduplicating reports across neighbouring archives', () => {
  test('keeps one row per (station, t), chosen by a fixed rule', async () => {
    expect(await publishedRows('first')).toEqual([
      [0, T, 3, 17, 0],
      [0, T + 5, 4, 16, 0],
    ]);
  });

  test('two builds from the same staged months write the same files', async () => {
    const second = await publishedRows('second');
    expect(second).toEqual(await publishedRows('third'));
    const manifest = (out: string) => readFile(join(dir, out, 'manifest.json'), 'utf8');
    expect(await manifest('second')).toBe(await manifest('third'));
  });
});
