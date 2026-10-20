import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { CacheEntry } from './download';
import { withDuckDB } from './duckdb';
import { createArchive, infoCsv, statusCsv } from './fixture';
import type { GapReport } from './gaps';
import { csvKind } from './month';
import { publish } from './publish';
import { stageMonth, type StagedReport } from './stage';

/** The upstream mistakes found by the first full build (ADR 0012), on a tiny scale. */

const at = (iso: string) => Date.parse(iso) / 1_000;
const status = (snapshot: string, station: number) =>
  [at(snapshot), 'IN_SERVICE', 10, station, 0, 1, 5, at(snapshot)] as const;
const info = (snapshot: string, station: number, name: string) =>
  [20, station, 2.18, name, 41.39, 10, at(snapshot)] as const;

const AUGUST = statusCsv([status('2026-08-10T10:00:00Z', 1), status('2026-08-10T10:05:00Z', 1)]);
const SEPTEMBER = statusCsv([status('2026-09-10T10:00:00Z', 1)]);
const SEPTEMBER_INFO = infoCsv([info('2026-09-10T10:00:00Z', 1, 'GRAN VIA')]);
const OCTOBER_INFO = infoCsv([info('2026-10-10T10:00:00Z', 1, 'GRAN VIA')]);

const source: CacheEntry = { resourceId: 'r', lastModified: null, bytes: 1, downloadedAt: '' };
let dir: string;
const reports = new Map<string, StagedReport>();

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'prepare-broken-'));
  const raw = join(dir, 'raw');
  const archives = {
    // Like 2022-03: the information archive holds the month's status CSV.
    '2026-08': { status: AUGUST, info: AUGUST },
    '2026-09': { status: SEPTEMBER, info: SEPTEMBER_INFO },
    // Like 2025-10: the status archive holds the month's information CSV.
    '2026-10': { status: OCTOBER_INFO, info: OCTOBER_INFO },
  };
  for (const [month, files] of Object.entries(archives)) {
    await createArchive(join(raw, 'estat-estacions-bicing'), `${month}.7z`, {
      [`${month}_a.csv`]: files.status,
    });
    await createArchive(join(raw, 'informacio-estacions-bicing'), `${month}.7z`, {
      [`${month}_b.csv`]: files.info,
    });
    const { report } = await stageMonth({
      rawDir: raw,
      stageDir: join(dir, 'stage'),
      scratchDir: join(dir, 'scratch'),
      month,
      sources: { status: source, info: source },
    });
    reports.set(month, report);
  }
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('broken upstream archives', () => {
  test('a status archive holding the wrong CSV makes the month unusable, with the reason', () => {
    expect(reports.get('2026-10')).toMatchObject({
      unusable: "the status archive holds the information CSV, not this dataset's",
    });
  });

  test('an information archive holding the wrong CSV is dropped, and the readings kept', () => {
    expect(reports.get('2026-08')).toMatchObject({
      observations: 2,
      informationProblem: "the information archive holds the status CSV, not this dataset's",
      stationsWithoutInfo: 1,
    });
  });

  test('publish names stations from other months and lists the unusable month', async () => {
    await publish({
      stageDir: join(dir, 'stage'),
      outDir: join(dir, 'parquet'),
      staged: ['2026-08', '2026-09'],
      catalogue: ['2026-08', '2026-09', '2026-10'],
      unusable: [{ month: '2026-10', reason: 'wrong file' }],
    });
    const stations = JSON.parse(await readFile(join(dir, 'parquet', 'stations.json'), 'utf8')) as {
      names: string[];
    };
    expect(stations.names).toEqual(['GRAN VIA']);
    const gaps = JSON.parse(await readFile(join(dir, 'parquet', 'gaps.json'), 'utf8')) as GapReport;
    expect(gaps.unusableMonths).toEqual([{ month: '2026-10', reason: 'wrong file' }]);
    // Its silence is detected from the snapshots like any other: September's last one to the end.
    expect(gaps.gaps.at(-1)).toMatchObject({
      from: '2026-09-10T10:00:00.000Z',
      to: '2026-11-01T00:00:00.000Z',
    });
  });

  test('a header with binary bytes in it is unreadable, like 2022-01', async () => {
    const path = join(dir, 'garbled.csv');
    await writeFile(
      path,
      Buffer.concat([
        Buffer.from('"station_id","name","ttl","V1","'),
        Buffer.from([0xae, 0x00, 0xff, 0x22, 0x0a]),
        Buffer.from('1,"GRAN VIA",0,NA,x\n'),
      ]),
    );
    expect(await withDuckDB((connection) => csvKind(connection, path))).toBe('unreadable');
  });
});
