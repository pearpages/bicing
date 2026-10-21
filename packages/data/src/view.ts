import {
  lowerBound,
  type AggregateColumns,
  type ObservationColumns,
  type StationTable,
  type TypedArray,
} from '@bicing/core';
import {
  AGGREGATE_SPEC,
  concatAggregates,
  concatMonths,
  RAW_SPEC,
  readColumns,
  validateAggregates,
  validateColumns,
  type DecodedAggregates,
  type DecodedColumns,
} from './columns';
import { fetchOk, type LoadDeps } from './load';
import { parseCatalog, type CatalogFile, type Level } from './manifest';
import { parseStations } from './stations';

/** One level of the whole history over a window (T2.5b, ADR 0014). */
export interface ViewOptions {
  readonly baseUrl: string;
  readonly level: Level;
  /** Half-open [t0, t1), minutes since the epoch. */
  readonly t0: number;
  readonly t1: number;
}

export type ViewColumns =
  | { readonly level: 'raw'; readonly observations: ObservationColumns }
  | { readonly level: '1h' | '1d'; readonly aggregates: AggregateColumns };

export interface ViewResult {
  readonly stations: StationTable;
  readonly columns: ViewColumns;
  /** The whole coverage, [first, last + 1): the chart's zoom extent at every level. */
  readonly extent: readonly [number, number];
}

/** Decoded files kept in the worker, so zooming back and forth doesn't fetch and decode again. */
const CACHE_FILES = 4;

type Decoded = DecodedColumns | DecodedAggregates;

/**
 * Loads views for one worker. It remembers the manifest and the station table, and the last
 * `CACHE_FILES` decoded files (least recently used goes first).
 */
export function createViewLoader(deps: LoadDeps): (options: ViewOptions) => Promise<ViewResult> {
  const catalogues = new Map<string, Promise<CatalogFile[]>>();
  const stationTables = new Map<string, Promise<StationTable>>();
  const files = new Map<string, Promise<Decoded>>();

  const json = async (url: URL) => (await fetchOk(deps, url)).json() as Promise<unknown>;
  const remember = <T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>) => {
    let hit = cache.get(key);
    if (!hit) {
      hit = load();
      cache.set(key, hit);
      // A failed load isn't kept: the next request tries again.
      hit.catch(() => cache.delete(key));
    }
    return hit;
  };

  const decode = (baseUrl: string, file: CatalogFile, stationCount: number): Promise<Decoded> => {
    const key = new URL(file.file, baseUrl).toString();
    const cached = files.get(key);
    if (cached) {
      // Refresh its place in the least-recently-used order.
      files.delete(key);
      files.set(key, cached);
      return cached;
    }
    const loading = (async () => {
      const bytes = new Uint8Array(await (await fetchOk(deps, new URL(key))).arrayBuffer());
      const ipc = await deps.decode(bytes);
      if (file.level === 'raw') {
        const columns = readColumns(ipc, RAW_SPEC, file.file);
        validateColumns(columns, stationCount, file.file);
        return columns;
      }
      const columns = readColumns(ipc, AGGREGATE_SPEC, file.file);
      validateAggregates(columns, stationCount, file.file);
      return columns;
    })();
    files.set(key, loading);
    loading.catch(() => files.delete(key));
    while (files.size > CACHE_FILES) {
      const oldest = files.keys().next().value;
      if (oldest === undefined) break;
      files.delete(oldest);
    }
    return loading;
  };

  return async ({ baseUrl, level, t0, t1 }) => {
    const catalogue = await remember(catalogues, baseUrl, async () =>
      parseCatalog(await json(new URL('manifest.json', baseUrl))),
    );
    const stations = await remember(stationTables, baseUrl, async () =>
      parseStations(await json(new URL('stations.json', baseUrl))),
    );
    const monthly = catalogue.filter((f) => f.level === 'raw' && f.month !== null);
    const first = Math.min(...monthly.map((f) => f.t0 ?? Number.POSITIVE_INFINITY));
    const last = Math.max(...monthly.map((f) => f.t1 ?? Number.NEGATIVE_INFINITY));
    if (!Number.isFinite(first) || !Number.isFinite(last))
      throw new Error('manifest.json lists no data');

    // The files of this level that overlap the window, oldest first.
    const wanted = catalogue
      .filter((f) => (level === 'raw' ? f.level === 'raw' && f.month !== null : f.level === level))
      .filter((f) => f.t0 !== null && f.t1 !== null && f.t0 < t1 && f.t1 >= t0)
      .sort((a, b) => (a.t0 ?? 0) - (b.t0 ?? 0));
    const decoded = await Promise.all(wanted.map((f) => decode(baseUrl, f, stations.length)));
    // Each file is sorted by t, so the window is one contiguous slice of it (P4).
    const slice = <C extends Decoded>(columns: C): C => {
      const start = lowerBound(columns.t, t0);
      const end = lowerBound(columns.t, t1, start);
      const out: Record<string, unknown> = {};
      for (const [name, values] of Object.entries(columns))
        out[name] = (values as TypedArray).subarray(start, end);
      return out as C;
    };
    const columns: ViewColumns =
      level === 'raw'
        ? { level, observations: concatMonths(decoded.map((c) => slice(c as DecodedColumns))) }
        : {
            level,
            aggregates: concatAggregates(decoded.map((c) => slice(c as DecodedAggregates))),
          };
    return { stations, columns, extent: [first, last + 1] };
  };
}
