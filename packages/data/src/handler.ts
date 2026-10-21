import { buildStationSeries, type ObservationColumns, type StationTable } from '@bicing/core';
import { generate } from '@bicing/synthetic';
import { loadMonths, type LoadDeps } from './load';
import { transferList, type WorkerRequest, type WorkerResponse } from './protocol';

export interface HandledResponse {
  readonly response: WorkerResponse;
  readonly transfer: ArrayBuffer[];
}

/**
 * The worker's logic without the worker: a function from a request to a response plus its transfer
 * list, so it can be unit-tested in Node. Loading real data needs a decoder and `fetch`, which the
 * worker and the tests provide differently (ADR 0013).
 */
export function createHandler(
  deps: LoadDeps,
): (request: WorkerRequest) => Promise<HandledResponse> {
  const columns = async (
    request: WorkerRequest,
  ): Promise<{ observations: ObservationColumns; stations: StationTable }> => {
    switch (request.type) {
      case 'generate':
        return generate(request.options);
      case 'load':
        return loadMonths(request.options, deps);
    }
  };

  return async (request) => {
    try {
      const started = performance.now();
      const { observations, stations } = await columns(request);
      // O(N) over the whole dataset: done here, not in the chart, so the main thread never pays for it (P8).
      const series = buildStationSeries(observations, stations);
      const elapsedMs = performance.now() - started;
      return {
        response: { id: request.id, type: 'dataset', observations, stations, series, elapsedMs },
        transfer: transferList(observations, stations, series),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { response: { id: request.id, type: 'error', message }, transfer: [] };
    }
  };
}
