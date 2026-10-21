import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { allocateObservations, type ObservationColumns } from '@bicing/core';
import { FILL_BINS, FilterState, HOUR_BINS, parseStations, type FilterRequest } from '@bicing/data';
import { describe, expect, test } from 'vitest';
import { asNumber, sqlString, withDuckDB } from './duckdb';

/**
 * T3.2's done-when: a brush update on a real month (4.5M rows) under 16 ms, through the same
 * FilterState the data worker runs (ADR 0015). Needs `pnpm prepare-data --build` first, so it's
 * skipped where data/parquet isn't there (CI). Run with `pnpm bench -- --run`.
 */
const PARQUET = resolve(import.meta.dirname, '../../../data/parquet');
const MONTH = join(PARQUET, 'observations-2026-09.parquet');
const FRAME_MS = 16;

async function readMonth(): Promise<ObservationColumns> {
  return withDuckDB(async (connection) => {
    const source = `read_parquet(${sqlString(MONTH)})`;
    const count = await connection.runAndReadAll(`SELECT count(*) FROM ${source}`);
    const length = asNumber(count.getRows()[0]?.[0] ?? 0);
    const columns = allocateObservations(length);
    const result = await connection.stream(
      `SELECT stationIdx, t, bikesMech, bikesElec, docks, status FROM ${source}`,
    );
    const targets = [
      columns.stationIdx,
      columns.t,
      columns.bikesMech,
      columns.bikesElec,
      columns.docks,
      columns.status,
    ];
    let offset = 0;
    for (
      let chunk = await result.fetchChunk();
      chunk && chunk.rowCount > 0;
      chunk = await result.fetchChunk()
    ) {
      targets.forEach((target, column) => {
        chunk.visitColumnValues(column, (value, row) => {
          target[offset + row] = asNumber(value);
        });
      });
      offset += chunk.rowCount;
    }
    return columns;
  });
}

/** 0, 1, …, max, max - 1, …: a brush dragged back and forth, never jumping. */
function pingPong(max: number): () => number {
  let at = 0;
  let direction = 1;
  return () => {
    if (at + direction < 0 || at + direction > max) direction = -direction;
    at += direction;
    return at;
  };
}

const result = (name: string) => `bench-results/filters-${name}.json`;

describe.skipIf(!existsSync(MONTH))('worker crossfilter on a real month (2026-09)', async () => {
  const observations = await readMonth();
  const stations = parseStations(
    JSON.parse(await readFile(join(PARQUET, 'stations.json'), 'utf8')),
  );
  const base: FilterRequest = { generation: 1, time: null, hour: null, fill: null, stations: null };

  // Plain timings: the bench loop would mostly measure garbage collection of ~100 MB a run.
  test('what a month load and the first filter cost', async () => {
    const costs = Array.from({ length: 3 }, () => {
      let started = performance.now();
      const fresh = new FilterState(observations, stations, 1);
      const load = performance.now() - started;
      started = performance.now();
      fresh.apply({ ...base, fill: [3, 8] });
      return { load, first: performance.now() - started, rows: fresh.rows };
    });
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[1] ?? 0;
    // Bench mode swallows console output, so this is written beside the other results.
    await mkdir(resolve(import.meta.dirname, '../bench-results'), { recursive: true });
    await writeFile(
      resolve(import.meta.dirname, '../bench-results/filters-load.json'),
      `${JSON.stringify(
        {
          rows: costs[0]?.rows,
          loadMs: median(costs.map((c) => c.load)),
          firstFilterMs: median(costs.map((c) => c.first)),
        },
        null,
        2,
      )}\n`,
    );
    expect(costs[0]?.rows).toBeGreaterThan(0);
  });

  const state = new FilterState(observations, stations, 1);
  // The first filter builds the indexes; drags measure what comes after.
  state.apply(base);
  const first = observations.t[0] ?? 0;
  const span = (observations.t[observations.length - 1] ?? 0) - first;

  test('occupancy brush drag', async ({ bench }) => {
    const step = pingPong(FILL_BINS - 5);
    const run = await bench('occupancy drag', { writeResult: result('occupancy-drag') }, () => {
      const lo = step();
      state.apply({ ...base, fill: [lo, lo + 5] });
    }).run();
    expect(run.latency.p99).toBeLessThan(FRAME_MS);
  });

  test('hour brush drag', async ({ bench }) => {
    const step = pingPong(HOUR_BINS - 3);
    const run = await bench('hour drag', { writeResult: result('hour-drag') }, () => {
      const lo = step();
      state.apply({ ...base, hour: [lo, lo + 3] });
    }).run();
    expect(run.latency.p99).toBeLessThan(FRAME_MS);
  });

  test('time brush drag, with an hour filter set', async ({ bench }) => {
    const step = pingPong(100);
    const run = await bench('time drag', { writeResult: result('time-drag') }, () => {
      const t0 = first + Math.floor((step() * span) / 200);
      state.apply({ ...base, hour: [7, 10], time: [t0, t0 + span / 2] });
    }).run();
    expect(run.latency.p99).toBeLessThan(FRAME_MS);
  });
});
