import {
  buildAggregateSeries,
  buildStationSeries,
  type ObservationColumns,
  type StationSeries,
  type StationTable,
} from '@bicing/core';
import { generate } from '@bicing/synthetic';
import { loadMonths, type LoadDeps } from './load';
import { transferList, type ViewInfo, type WorkerRequest, type WorkerResponse } from './protocol';
import { createViewLoader } from './view';

export interface HandledResponse {
  readonly response: WorkerResponse;
  readonly transfer: ArrayBuffer[];
}

/** Bucket sizes of ADR 0014's levels, in minutes: also each level's gap threshold. */
const BUCKET_MINUTES = { '1h': 60, '1d': 1_440 } as const;

interface Built {
  readonly observations: ObservationColumns | null;
  readonly stations: StationTable;
  readonly series: StationSeries;
  readonly rows: number;
  readonly view: ViewInfo | null;
}

/** The view loader keeps its station table for the next request; transferring would detach it. */
const copyStations = (stations: StationTable): StationTable => ({
  ...stations,
  lat: stations.lat.slice(),
  lon: stations.lon.slice(),
  capacity: stations.capacity.slice(),
});

/**
 * The worker's logic without the worker: a function from a request to a response plus its transfer
 * list, so it can be unit-tested in Node. Loading real data needs a decoder and `fetch`, which the
 * worker and the tests provide differently (ADR 0013).
 */
export function createHandler(
  deps: LoadDeps,
): (request: WorkerRequest) => Promise<HandledResponse> {
  const loadView = createViewLoader(deps);

  // O(N) over the loaded data: done here, not in the chart, so the main thread never pays for it (P8).
  const build = async (request: WorkerRequest): Promise<Built> => {
    switch (request.type) {
      case 'generate':
      case 'load': {
        const { observations, stations } =
          request.type === 'generate'
            ? generate(request.options)
            : await loadMonths(request.options, deps);
        const series = buildStationSeries(observations, stations);
        return { observations, stations, series, rows: observations.length, view: null };
      }
      case 'view': {
        const { t0, t1 } = request.options;
        const result = await loadView(request.options);
        const stations = copyStations(result.stations);
        const view: ViewInfo = {
          level: result.columns.level,
          extent: result.extent,
          window: [t0, t1],
        };
        if (result.columns.level === 'raw') {
          const { observations } = result.columns;
          const series = buildStationSeries(observations, stations);
          return { observations, stations, series, rows: observations.length, view };
        }
        const { aggregates, level } = result.columns;
        const series = buildAggregateSeries(aggregates, stations, BUCKET_MINUTES[level]);
        return { observations: null, stations, series, rows: aggregates.length, view };
      }
    }
  };

  return async (request) => {
    try {
      const started = performance.now();
      const { observations, stations, series, rows, view } = await build(request);
      const elapsedMs = performance.now() - started;
      return {
        response: {
          id: request.id,
          type: 'dataset',
          observations,
          stations,
          series,
          rows,
          view,
          elapsedMs,
        },
        transfer: transferList(observations, stations, series),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { response: { id: request.id, type: 'error', message }, transfer: [] };
    }
  };
}
