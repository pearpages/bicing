import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildStationSeries, Status, toMinutes } from '@bicing/core';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createArchive, INFO_ROWS, infoCsv, sep, STATUS_ROWS, statusCsv } from './fixture';
import { readMonth } from './columns';
import { prepareMonth } from './prepare';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'prepare-month-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function month(status = STATUS_ROWS, info = INFO_ROWS) {
  const statusPath = join(dir, 'status.csv');
  const infoPath = join(dir, 'info.csv');
  await writeFile(statusPath, statusCsv(status));
  await writeFile(infoPath, infoCsv(info));
  return readMonth({
    month: '2026-09',
    statusCsv: statusPath,
    infoCsv: infoPath,
    ...FIXTURE_TOLERANCE,
  });
}

const minute = (seconds: number) => toMinutes(seconds * 1_000);

// A few bad rows among a handful is the point of the fixture; real months stay under the defaults.
const FIXTURE_TOLERANCE = { maxInvalidShare: 0.5, maxRepairedShare: 0.5 };

describe('readMonth', () => {
  test('maps stations to dense indices in id order, with the latest information', async () => {
    const { stations, report } = await month();
    // Station 3 only had a stale report, so it has no readings this month and no row.
    expect(stations.ids).toEqual(['1', '2', '9']);
    expect(stations.names).toEqual(['GRAN VIA, 760', 'ROGER DE FLOR, 126', '#9']);
    expect(stations.lat[0]).toBeCloseTo(41.39, 5);
    expect(Number.isNaN(stations.lat[2])).toBe(true);
    expect(stations.capacity[0]).toBe(20);
    // The shifted row said 1; the station held 15 bikes + 5 docks, then 0 + 20.
    expect(stations.capacity[1]).toBe(20);
    expect(stations.capacity[2]).toBe(0);
    expect(report).toMatchObject({ stationsWithoutInfo: 1, capacityFromReadings: 1 });
  });

  test('times come from last_reported, sorted by (t, stationIdx), one row per report', async () => {
    const { observations: o, report } = await month();
    const rows = Array.from({ length: o.length }, (_, i) => [
      o.t[i],
      o.stationIdx[i],
      o.bikesMech[i],
      o.bikesElec[i],
      o.docks[i],
      o.status[i],
    ]);
    expect(rows).toEqual([
      [minute(sep(1, 10, 1)), 2, 0, 0, 0, Status.Other],
      [minute(sep(1, 10, 3)), 1, 15, 0, 5, Status.InService],
      [minute(sep(1, 10, 4)), 0, 8, 2, 10, Status.InService],
      [minute(sep(1, 10, 9)), 0, 8, 3, 9, Status.InService],
      [minute(sep(1, 10, 9)), 1, 0, 0, 20, Status.Closed],
    ]);
    expect(report).toEqual({
      month: '2026-09',
      statusRows: 8,
      invalidStatusRows: 1,
      staleReports: 1,
      repeatedReports: 1,
      infoRows: 4,
      invalidInfoRows: 0,
      stations: 3,
      stationsWithoutInfo: 1,
      capacityFromReadings: 1,
      observations: 5,
    });
  });

  test('the columns round-trip into station series', async () => {
    const { observations, stations } = await month();
    const series = buildStationSeries(observations, stations);
    // Only in-service rows become line points (station 9 is PLANNED, station 2's last row closed).
    expect(series.x.length).toBe(3);
    expect(series.offsets.length).toBe(stations.length + 1);
  });

  test('drops information rows outside Barcelona or with bad numbers', async () => {
    const { report, stations } = await month(STATUS_ROWS, [
      ...INFO_ROWS,
      [20, 1, 2.18, 'SOMEWHERE ELSE', 48.85, 16, sep(1, 11, 0)],
      [20, 1, 'x', 'BROKEN', 41.39, 16, sep(1, 11, 0)],
    ]);
    expect(report.invalidInfoRows).toBe(2);
    // The newer but invalid rows don't win.
    expect(stations.names[0]).toBe('GRAN VIA, 760');
  });

  test('fails a month over the default 1% of invalid rows', async () => {
    const statusPath = join(dir, 'status.csv');
    await writeFile(statusPath, statusCsv(STATUS_ROWS));
    await writeFile(join(dir, 'info.csv'), infoCsv(INFO_ROWS));
    await expect(
      readMonth({ month: '2026-09', statusCsv: statusPath, infoCsv: join(dir, 'info.csv') }),
    ).rejects.toThrow(/2026-09 status: 1 of 8 rows are invalid \(over 1%\)/);
  });

  test('fails a month whose rows mostly fail their casts', async () => {
    const broken = STATUS_ROWS.map((row) => row.map((v, i) => (i === 2 ? 'NA' : v)));
    await expect(month(broken)).rejects.toThrow(/2026-09 status: 8 of 8 rows are invalid/);
  });

  test('fails a month whose information capacities mostly contradict the readings', async () => {
    const shifted = INFO_ROWS.map((row) => [1, ...row.slice(1)]);
    await expect(month(STATUS_ROWS, shifted)).rejects.toThrow(
      /2 of 3 stations have a capacity below half/,
    );
  });

  test('fails when a required column is missing, naming it', async () => {
    const path = join(dir, 'status.csv');
    await writeFile(path, 'station_id,status\n1,"IN_SERVICE"');
    await writeFile(join(dir, 'info.csv'), infoCsv(INFO_ROWS));
    await expect(
      readMonth({ month: '2026-09', statusCsv: path, infoCsv: join(dir, 'info.csv') }),
    ).rejects.toThrow(/missing columns num_bikes_available_types\.mechanical/);
  });
});

describe('prepareMonth', () => {
  test('extracts both archives, reads the month and removes the CSVs', async () => {
    const raw = join(dir, 'raw');
    await createArchive(join(raw, 'estat-estacions-bicing'), '2026-09.7z', {
      '2026_09_Setembre_BicingNou_ESTACIONS.csv': statusCsv(STATUS_ROWS),
    });
    await createArchive(join(raw, 'informacio-estacions-bicing'), '2026-09.7z', {
      '2026_09_Setembre_BicingNou_INFORMACIO.csv': infoCsv(INFO_ROWS),
    });
    const scratch = join(dir, 'scratch');
    const { observations, stations } = await prepareMonth(
      raw,
      '2026-09',
      scratch,
      FIXTURE_TOLERANCE,
    );
    expect(observations.length).toBe(5);
    expect(stations.ids).toEqual(['1', '2', '9']);
    expect(await readdir(scratch)).toEqual([]);
  });
});
