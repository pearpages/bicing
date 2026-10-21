import { Status } from '@bicing/core';
import { tableFromArrays, tableToIPC } from 'apache-arrow';
import * as parquet from 'parquet-wasm/node';
import { describe, expect, test } from 'vitest';
import { createHandler } from './handler';
import { createViewLoader } from './view';

/** Node's parquet-wasm initialises synchronously; the worker uses the ESM build (ADR 0013). */
const decode = (bytes: Uint8Array) =>
  new Promise<Uint8Array>((resolve) => {
    resolve(parquet.readParquet(bytes).intoIPCStream());
  });

const write = (columns: Record<string, ArrayLike<number>>) =>
  parquet.writeParquet(
    parquet.Table.fromIPCStream(
      tableToIPC(tableFromArrays(columns as Parameters<typeof tableFromArrays>[0]), 'stream'),
    ),
  );

/** Raw rows: [station, t, mech]; every row in service. */
const raw = (rows: [number, number, number][]) =>
  write({
    stationIdx: Uint16Array.from(rows.map((r) => r[0])),
    t: Uint32Array.from(rows.map((r) => r[1])),
    bikesMech: Uint8Array.from(rows.map((r) => r[2])),
    bikesElec: Uint8Array.from(rows.map(() => 0)),
    docks: Uint8Array.from(rows.map(() => 10)),
    status: Uint8Array.from(rows.map(() => Status.InService)),
  });

/** Buckets: [station, t, min, max]. */
const buckets = (rows: [number, number, number, number][]) =>
  write({
    stationIdx: Uint16Array.from(rows.map((r) => r[0])),
    t: Uint32Array.from(rows.map((r) => r[1])),
    min: Uint8Array.from(rows.map((r) => r[2])),
    max: Uint8Array.from(rows.map((r) => r[3])),
    mean: Float32Array.from(rows.map((r) => (r[2] + r[3]) / 2)),
    count: Uint16Array.from(rows.map(() => 12)),
  });

const DAY = 1_440;
const entry = (file: string, level: string, month: string | null, t0: number, t1: number) => ({
  file,
  level,
  month,
  rows: 1,
  bytes: 1,
  t0,
  t1,
});

/** A tiny published set: two raw months, the daily file and one hourly year. */
function files() {
  return {
    'manifest.json': {
      files: [
        entry('observations-2026-08.parquet', 'raw', '2026-08', 0, 100),
        entry('observations-2026-09.parquet', 'raw', '2026-09', 200, 300),
        entry('observations.parquet', 'raw', null, 0, 300),
        entry('agg-1d.parquet', '1d', null, 0, DAY),
        entry('agg-1h-2026.parquet', '1h', null, 0, 240),
      ],
    },
    'stations.json': {
      ids: ['1', '2'],
      names: ['A', 'B'],
      lat: [41.4, 41.4],
      lon: [2.1, 2.1],
      capacity: [20, 20],
    },
    'observations-2026-08.parquet': raw([
      [0, 0, 1],
      [1, 50, 2],
      [0, 100, 3],
    ]),
    'observations-2026-09.parquet': raw([
      [0, 200, 4],
      [1, 300, 5],
    ]),
    'agg-1d.parquet': buckets([
      [0, 0, 1, 9],
      [1, 0, 2, 8],
      [0, DAY, 3, 7],
    ]),
    'agg-1h-2026.parquet': buckets([
      [0, 0, 1, 2],
      [0, 60, 3, 4],
      [0, 180, 5, 6],
    ]),
  } as Record<string, Uint8Array | object>;
}

const BASE = 'https://data.example/bicing/';

/** A static host that counts what it serves. */
function host(served: Record<string, Uint8Array | object>) {
  const fetched: string[] = [];
  const fetchImpl: typeof fetch = (input) => {
    const path = new URL(input instanceof Request ? input.url : input).pathname.replace(
      '/bicing/',
      '',
    );
    fetched.push(path);
    const body = served[path];
    if (body === undefined) return Promise.resolve(new Response(null, { status: 404 }));
    return Promise.resolve(
      new Response(body instanceof Uint8Array ? body.slice().buffer : JSON.stringify(body)),
    );
  };
  return { fetchImpl, fetched };
}

describe('createViewLoader', () => {
  test('raw: the monthly files that overlap the window, sliced to it', async () => {
    const { fetchImpl } = host(files());
    const load = createViewLoader({ decode, fetch: fetchImpl });
    const result = await load({ baseUrl: BASE, level: 'raw', t0: 50, t1: 250 });
    if (result.columns.level !== 'raw') throw new Error('expected raw columns');
    expect(Array.from(result.columns.observations.t)).toEqual([50, 100, 200]);
    // The coverage comes from the monthly files, whatever level is loaded.
    expect(result.extent).toEqual([0, 301]);
  });

  test('aggregates: one level, sliced to the window', async () => {
    const { fetchImpl } = host(files());
    const load = createViewLoader({ decode, fetch: fetchImpl });
    const result = await load({ baseUrl: BASE, level: '1h', t0: 60, t1: 240 });
    if (result.columns.level === 'raw') throw new Error('expected aggregates');
    expect(Array.from(result.columns.aggregates.t)).toEqual([60, 180]);
    expect(Array.from(result.columns.aggregates.max)).toEqual([4, 6]);
  });

  test('keeps decoded files: zooming back does not fetch them again', async () => {
    const { fetchImpl, fetched } = host(files());
    const load = createViewLoader({ decode, fetch: fetchImpl });
    await load({ baseUrl: BASE, level: '1d', t0: 0, t1: 2 * DAY });
    await load({ baseUrl: BASE, level: 'raw', t0: 0, t1: 300 });
    await load({ baseUrl: BASE, level: '1d', t0: 0, t1: DAY });
    expect(fetched.filter((path) => path === 'agg-1d.parquet')).toHaveLength(1);
    expect(fetched.filter((path) => path === 'manifest.json')).toHaveLength(1);
  });

  test('rejects buckets whose min is above their max', async () => {
    const served = { ...files(), 'agg-1d.parquet': buckets([[0, 0, 9, 1]]) };
    const load = createViewLoader({ decode, fetch: host(served).fetchImpl });
    await expect(load({ baseUrl: BASE, level: '1d', t0: 0, t1: DAY })).rejects.toThrow(
      /min above max/,
    );
  });
});

describe('view requests in the handler', () => {
  test('an aggregate view becomes min/max pairs, with the level, extent and window', async () => {
    const handle = createHandler({ decode, fetch: host(files()).fetchImpl });
    const { response } = await handle({
      id: 1,
      type: 'view',
      options: { baseUrl: BASE, level: '1d', t0: 0, t1: 2 * DAY },
    });
    if (response.type !== 'dataset') throw new Error(`expected a dataset, got ${response.type}`);
    expect(response.observations).toBeNull();
    expect(response.rows).toBe(3);
    expect(response.series.x).toHaveLength(6);
    expect(response.series.maxGap).toBe(DAY);
    expect(response.view).toEqual({ level: '1d', extent: [0, 301], window: [0, 2 * DAY] });
  });

  test('transferring a view does not break the next one (the station table is copied)', async () => {
    const handle = createHandler({ decode, fetch: host(files()).fetchImpl });
    const view = (id: number) =>
      handle({ id, type: 'view', options: { baseUrl: BASE, level: '1d', t0: 0, t1: DAY } });
    const first = await view(1);
    structuredClone(first.response, { transfer: first.transfer });
    const second = await view(2);
    if (second.response.type !== 'dataset') throw new Error('expected a dataset');
    expect(Array.from(second.response.stations.capacity)).toEqual([20, 20]);
  });
});
