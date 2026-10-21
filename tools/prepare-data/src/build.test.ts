import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toMinutes } from '@bicing/core';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { CacheEntry } from './download';
import { asNumber, sqlString, withDuckDB } from './duckdb';
import { createArchive, infoCsv, statusCsv } from './fixture';
import type { GapReport } from './gaps';
import { publish, type PublishSummary } from './publish';
import { stageMonth } from './stage';

const at = (iso: string) => Date.parse(iso) / 1_000;
const minute = (iso: string) => toMinutes(Date.parse(iso));

/** Status row: [last_updated, status, docks, station, ebikes, installed, mech, last_reported]. */
const reading = (snapshot: string, station: number, mech: number, reported = snapshot) =>
  [at(snapshot), 'IN_SERVICE', 20 - mech, station, 0, 1, mech, at(reported)] as const;
/** Info row: [capacity, station, lon, name, lat, altitude, last_updated]. */
const station = (id: number, name: string, snapshot: string) =>
  [20, id, 2.18, name, 41.39, 10, at(snapshot)] as const;

const MONTHS = {
  // July: two snapshots, both stations.
  '2026-07': {
    status: [
      reading('2026-07-10T10:00:00Z', 1, 5),
      reading('2026-07-10T10:00:00Z', 2, 6),
      reading('2026-07-10T10:05:00Z', 1, 7),
      reading('2026-07-10T10:05:00Z', 2, 8),
    ],
    info: [
      station(1, 'GRAN VIA', '2026-07-10T10:00:00Z'),
      station(2, 'OLD NAME', '2026-07-10T10:00:00Z'),
    ],
  },
  // September's archive starts at 00:00 Barcelona time, which is 22:00 UTC on 31 August.
  '2026-09': {
    status: [
      reading('2026-08-31T22:30:00Z', 1, 9),
      reading('2026-08-31T22:30:00Z', 3, 1),
      reading('2026-09-01T10:00:00Z', 1, 10),
      reading('2026-09-01T10:00:00Z', 3, 2),
    ],
    info: [
      station(1, 'GRAN VIA', '2026-09-01T10:00:00Z'),
      station(3, 'NÀPOLS', '2026-09-01T10:00:00Z'),
    ],
  },
} as const;

const source = (month: string): CacheEntry => ({
  resourceId: month,
  lastModified: null,
  bytes: 1,
  downloadedAt: '',
});

let dir: string;
let summary: PublishSummary;
let restagedCached: boolean;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'prepare-build-'));
  const raw = join(dir, 'raw');
  for (const [month, { status, info }] of Object.entries(MONTHS)) {
    await createArchive(join(raw, 'estat-estacions-bicing'), `${month}.7z`, {
      [`${month}_status.csv`]: statusCsv(status),
    });
    await createArchive(join(raw, 'informacio-estacions-bicing'), `${month}.7z`, {
      [`${month}_info.csv`]: infoCsv(info),
    });
  }
  const stage = (month: string) =>
    stageMonth({
      rawDir: raw,
      stageDir: join(dir, 'stage'),
      scratchDir: join(dir, 'scratch'),
      month,
      sources: { status: source(month), info: source(month) },
    });
  for (const month of Object.keys(MONTHS)) await stage(month);
  restagedCached = (await stage('2026-07')).cached;
  summary = await publish({
    stageDir: join(dir, 'stage'),
    outDir: join(dir, 'parquet'),
    staged: Object.keys(MONTHS),
    catalogue: Object.keys(MONTHS),
  });
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function rows(file: string): Promise<number[][]> {
  return withDuckDB(async (connection) => {
    const reader = await connection.runAndReadAll(
      `SELECT stationIdx, t, bikesMech FROM read_parquet(${sqlString(join(dir, 'parquet', file))})`,
    );
    return reader.getRows().map((row) => row.map((v) => asNumber(v ?? 0)));
  });
}

describe('stage + publish', () => {
  test('re-staging a month from the same archives is a no-op', () => {
    expect(restagedCached).toBe(true);
  });

  test('one station table for every month, from the latest month a station appears in', async () => {
    const stations = JSON.parse(await readFile(join(dir, 'parquet', 'stations.json'), 'utf8')) as {
      ids: string[];
      names: string[];
    };
    expect(stations.ids).toEqual(['1', '2', '3']);
    expect(stations.names).toEqual(['GRAN VIA', 'OLD NAME', 'NÀPOLS']);
    expect(summary.stations).toBe(3);
  });

  test("rows go to their UTC month, even from a neighbour's archive", async () => {
    expect(summary.files.map((f) => f.file)).toEqual([
      'observations-2026-07.parquet',
      'observations-2026-08.parquet',
      'observations-2026-09.parquet',
      'observations.parquet',
      'agg-1d.parquet',
      'agg-1h-2026.parquet',
    ]);
    expect(summary.files.map((f) => f.level)).toEqual(['raw', 'raw', 'raw', 'raw', '1d', '1h']);
    expect(await rows('observations-2026-08.parquet')).toEqual([
      [0, minute('2026-08-31T22:30:00Z'), 9],
      [2, minute('2026-08-31T22:30:00Z'), 1],
    ]);
    expect(await rows('observations-2026-09.parquet')).toEqual([
      [0, minute('2026-09-01T10:00:00Z'), 10],
      [2, minute('2026-09-01T10:00:00Z'), 2],
    ]);
  });

  test('the merged file holds every month, sorted by (t, stationIdx)', async () => {
    const merged = await rows('observations.parquet');
    expect(merged).toHaveLength(8);
    const sorted = [...merged].sort(
      (a, b) => (a[1] ?? 0) - (b[1] ?? 0) || (a[0] ?? 0) - (b[0] ?? 0),
    );
    expect(merged).toEqual(sorted);
    expect(summary.files.find((f) => f.file === 'observations.parquet')).toMatchObject({
      rows: 8,
      month: null,
    });
  });

  test('aggregates hold min, max, mean and count per station and UTC bucket', async () => {
    const buckets = await withDuckDB(async (connection) => {
      const reader = await connection.runAndReadAll(
        `SELECT stationIdx, t, min, max, mean, count
         FROM read_parquet(${sqlString(join(dir, 'parquet', 'agg-1h-2026.parquet'))})`,
      );
      return reader.getRows().map((row) => row.map((v) => asNumber(v ?? 0)));
    });
    expect(buckets).toEqual([
      // July 10, 10:00 UTC: station 1 read 5 then 7 bikes; station 2 read 6 then 8.
      [0, minute('2026-07-10T10:00:00Z'), 5, 7, 6, 2],
      [1, minute('2026-07-10T10:00:00Z'), 6, 8, 7, 2],
      [0, minute('2026-08-31T22:00:00Z'), 9, 9, 9, 1],
      [2, minute('2026-08-31T22:00:00Z'), 1, 1, 1, 1],
      [0, minute('2026-09-01T10:00:00Z'), 10, 10, 10, 1],
      [2, minute('2026-09-01T10:00:00Z'), 2, 2, 2, 1],
    ]);
    const days = summary.files.find((f) => f.file === 'agg-1d.parquet');
    // One bucket per station and UTC day with readings: 2 on Jul 10, 2 on Aug 31, 2 on Sep 1.
    expect(days).toMatchObject({ level: '1d', rows: 6, t0: minute('2026-07-10T00:00:00Z') });
  });

  test('gaps.json names the missing month and the silences, detected from the snapshots', async () => {
    const gaps = JSON.parse(await readFile(join(dir, 'parquet', 'gaps.json'), 'utf8')) as GapReport;
    expect(gaps.missingMonths).toEqual(['2026-08']);
    expect(gaps.thresholdMinutes).toBe(15);
    expect(gaps.gaps.map((g) => [g.from, g.to])).toEqual([
      ['2026-07-01T00:00:00.000Z', '2026-07-10T10:00:00.000Z'],
      ['2026-07-10T10:05:00.000Z', '2026-08-31T22:30:00.000Z'],
      ['2026-08-31T22:30:00.000Z', '2026-09-01T10:00:00.000Z'],
      ['2026-09-01T10:00:00.000Z', '2026-10-01T00:00:00.000Z'],
    ]);
    expect(gaps.missingDays).toContain('2026-08-15');
    expect(gaps.missingDays).not.toContain('2026-08-31');
  });
});
