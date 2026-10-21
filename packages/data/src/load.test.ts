import { Status } from '@bicing/core';
import { tableFromArrays, tableToIPC } from 'apache-arrow';
import * as parquet from 'parquet-wasm/node';
import { describe, expect, test } from 'vitest';
import { RAW_SPEC, readColumns } from './columns';
import { createHandler } from './handler';
import { loadMonths } from './load';
import { fetchManifest, parseCatalog, parseManifest } from './manifest';
import { parseStations } from './stations';

// Node's parquet-wasm initialises synchronously; the executor turns a decoding error into a
// rejection, as the worker's async decoder does.
const decode = (bytes: Uint8Array) =>
  new Promise<Uint8Array>((resolve) => {
    resolve(parquet.readParquet(bytes).intoIPCStream());
  });

/** A real Parquet file in T2.3's schema, written by parquet-wasm with Snappy. */
function parquetFile(rows: readonly (readonly [number, number, number?, number?])[]): Uint8Array {
  const column = <T extends Uint8Array | Uint16Array | Uint32Array>(
    Type: { from(values: number[]): T },
    pick: (row: readonly [number, number, number?, number?]) => number,
  ) => Type.from(rows.map(pick));
  const table = tableFromArrays({
    stationIdx: column(Uint16Array, (r) => r[0]),
    t: column(Uint32Array, (r) => r[1]),
    bikesMech: column(Uint8Array, (r) => r[2] ?? 5),
    bikesElec: column(Uint8Array, () => 1),
    docks: column(Uint8Array, () => 10),
    status: column(Uint8Array, (r) => r[3] ?? Status.InService),
  });
  const properties = new parquet.WriterPropertiesBuilder()
    .setCompression(parquet.Compression.SNAPPY)
    .build();
  return parquet.writeParquet(parquet.Table.fromIPCStream(tableToIPC(table, 'stream')), properties);
}

const STATIONS = {
  ids: ['1', '2'],
  names: ['GRAN VIA', '#2'],
  lat: [41.39, null],
  lon: [2.18, null],
  capacity: [20, 0],
};

const BASE = 'https://data.example/bicing/';

/** A static host: path → body. Anything else is a 404. */
function host(files: Record<string, Uint8Array | object>): typeof fetch {
  return (input) => {
    const path = new URL(input instanceof Request ? input.url : input).pathname.replace(
      '/bicing/',
      '',
    );
    const body = files[path];
    if (body === undefined) return Promise.resolve(new Response(null, { status: 404 }));
    return Promise.resolve(
      new Response(body instanceof Uint8Array ? body.slice().buffer : JSON.stringify(body), {
        status: 200,
      }),
    );
  };
}

const goodFiles = () => ({
  'stations.json': STATIONS,
  'observations-2026-08.parquet': parquetFile([
    [0, 100],
    [1, 100],
    [0, 105],
  ]),
  'observations-2026-09.parquet': parquetFile([
    [1, 200, 7],
    [0, 205, 8, Status.Closed],
  ]),
});

describe('loadMonths', () => {
  test('decodes real Parquet and joins the months in order, as typed arrays', async () => {
    const { observations, stations } = await loadMonths(
      { baseUrl: BASE, months: ['2026-08', '2026-09'] },
      { decode, fetch: host(goodFiles()) },
    );
    expect(Array.from(observations.t)).toEqual([100, 100, 105, 200, 205]);
    expect(Array.from(observations.stationIdx)).toEqual([0, 1, 0, 1, 0]);
    expect(Array.from(observations.bikesMech)).toEqual([5, 5, 5, 7, 8]);
    expect(Array.from(observations.status)).toEqual([0, 0, 0, 0, Status.Closed]);
    expect(observations.t).toBeInstanceOf(Uint32Array);
    expect(observations.stationIdx).toBeInstanceOf(Uint16Array);
    expect(stations.names).toEqual(['GRAN VIA', '#2']);
    expect(Number.isNaN(stations.lat[1])).toBe(true);
  });

  test('the worker handler turns a load into a transferable dataset', async () => {
    const handle = createHandler({ decode, fetch: host(goodFiles()) });
    const { response, transfer } = await handle({
      id: 9,
      type: 'load',
      options: { baseUrl: BASE, months: ['2026-08', '2026-09'] },
    });
    if (response.type !== 'dataset') throw new Error(`expected a dataset, got ${response.type}`);
    expect(response.rows).toBe(5);
    expect(response.series.offsets).toHaveLength(3);
    expect(transfer.length).toBeGreaterThan(0);
  });

  const reject = async (files: Record<string, Uint8Array | object>, months = ['2026-08']) =>
    loadMonths({ baseUrl: BASE, months }, { decode, fetch: host(files) });

  test('rejects a station index outside the station table', async () => {
    await expect(
      reject({ ...goodFiles(), 'observations-2026-08.parquet': parquetFile([[2, 100]]) }),
    ).rejects.toThrow(/2026-08: station index out of range/);
  });

  test('rejects rows that are not sorted by time', async () => {
    const unsorted = parquetFile([
      [0, 200],
      [0, 100],
    ]);
    await expect(
      reject({ ...goodFiles(), 'observations-2026-08.parquet': unsorted }),
    ).rejects.toThrow(/not sorted by time/);
  });

  test('rejects an unknown status', async () => {
    await expect(
      reject({ ...goodFiles(), 'observations-2026-08.parquet': parquetFile([[0, 100, 5, 9]]) }),
    ).rejects.toThrow(/unknown status/);
  });

  test('rejects months that overlap', async () => {
    await expect(reject(goodFiles(), ['2026-09', '2026-08'])).rejects.toThrow(/overlap/);
  });

  test('rejects a missing file and a month name that is not a month', async () => {
    await expect(reject(goodFiles(), ['2026-07'])).rejects.toThrow(/HTTP 404/);
    await expect(reject(goodFiles(), ['../stations'])).rejects.toThrow(/not a month/);
  });

  test('rejects a Parquet file with the wrong column types', () => {
    const table = tableFromArrays({ stationIdx: Float64Array.from([0]), t: Uint32Array.from([1]) });
    const wrong = parquet.writeParquet(parquet.Table.fromIPCStream(tableToIPC(table, 'stream')));
    expect(() => readColumns(parquet.readParquet(wrong).intoIPCStream(), RAW_SPEC, 'test')).toThrow(
      /column stationIdx is missing or not Uint16Array/,
    );
  });
});

describe('stations.json and manifest.json', () => {
  test('parseStations rejects mismatched lengths and wrong types', () => {
    expect(() => parseStations({ ...STATIONS, names: ['one'] })).toThrow(/different lengths/);
    expect(() => parseStations({ ...STATIONS, capacity: [20, 300] })).toThrow(/unexpected fields/);
    expect(() => parseStations({ ...STATIONS, lat: [41.39, '0'] })).toThrow(/unexpected fields/);
    expect(() => parseStations(null)).toThrow(/not an object/);
  });

  const file = (name: string, level: string, month: string | null, t0 = 0) => ({
    file: name,
    level,
    month,
    rows: 3,
    bytes: 12,
    t0,
    t1: t0 + 10,
  });

  test('parseManifest lists the monthly files, oldest first, without the merged one', async () => {
    const manifest = {
      files: [
        file('observations-2026-09.parquet', 'raw', '2026-09'),
        file('observations-2026-08.parquet', 'raw', '2026-08'),
        file('observations.parquet', 'raw', null),
        file('agg-1d.parquet', '1d', null),
        file('agg-1h-2026.parquet', '1h', null),
      ],
    };
    expect(parseManifest(manifest).map((m) => m.month)).toEqual(['2026-08', '2026-09']);
    expect(await fetchManifest(BASE, host({ 'manifest.json': manifest }))).toHaveLength(2);
    expect(parseCatalog(manifest).map((f) => f.level)).toEqual(['raw', 'raw', 'raw', '1d', '1h']);
  });

  test('parseCatalog rejects any file name T2.3 and T2.5a do not write', () => {
    for (const bad of [
      file('../stations.json', 'raw', '2026-09'),
      file('observations-2026-08.parquet', 'raw', '2026-09'),
      file('agg-1h-26.parquet', '1h', null),
      file('agg-1d.parquet', '1h', null),
      file('agg-1d.parquet', '1d', '2026-09'),
      file('https://evil.example/x.parquet', '1d', null),
      { ...file('agg-1d.parquet', '1d', null), t0: -1 },
    ])
      expect(() => parseCatalog({ files: [bad] }), JSON.stringify(bad)).toThrow(/invalid entry/);
    // Manifests from before T2.5a have no level: their files are raw.
    const legacy = {
      file: 'observations-2026-09.parquet',
      month: '2026-09',
      rows: 1,
      bytes: 1,
      t0: 0,
      t1: 1,
    };
    expect(parseCatalog({ files: [legacy] })[0]?.level).toBe('raw');
  });
});
