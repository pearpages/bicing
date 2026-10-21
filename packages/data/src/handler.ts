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
import { FilterState } from './filters';
import { BUCKET_MINUTES } from './manifest';
import { createViewLoader } from './view';

export interface HandledResponse {
  readonly response: WorkerResponse;
  readonly transfer: ArrayBuffer[];
}

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
  // The crossfilter of the latest raw dataset, kept in the worker (ADR 0015). Each dataset gets a
  // new generation, so a filter meant for an older one is refused instead of answered wrongly.
  let filters: FilterState | null = null;
  let generation = 0;

  // O(N) over the loaded data: done here, not in the chart, so the main thread never pays for it (P8).
  const build = async (
    request: Exclude<WorkerRequest, { readonly type: 'filter' }>,
  ): Promise<Built> => {
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
      if (request.type === 'filter') {
        const state = filters;
        if (!state) throw new Error('No crossfilter for this dataset');
        if (state.generation !== request.filters.generation)
          throw new Error(
            `Filters for dataset ${String(request.filters.generation)}, not ${String(state.generation)}`,
          );
        const result = state.apply(request.filters);
        return {
          response: { id: request.id, type: 'filtered', result },
          transfer: [
            result.hour.buffer,
            result.fill.buffer,
            result.stations.buffer,
          ] as ArrayBuffer[],
        };
      }
      const started = performance.now();
      const { observations, stations, series, rows, view } = await build(request);
      // Built before the transfer below hands the columns to the page; it keeps its own copies.
      generation += 1;
      filters = observations ? new FilterState(observations, stations, generation) : null;
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
          generation: filters ? generation : null,
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
