import type { ObservationColumns, StationSeries, StationTable } from '@bicing/core';
import type { GenerateOptions } from '@bicing/synthetic';
import type { WorkerRequest, WorkerResponse } from './protocol';

/** The slice of the Worker API the client uses, so tests can pass a fake. */
export interface WorkerLike {
  postMessage(message: WorkerRequest): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerResponse>) => void): void;
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  terminate(): void;
}

export interface GeneratedDataset {
  readonly observations: ObservationColumns;
  readonly stations: StationTable;
  readonly series: StationSeries;
  /** Generation + series building inside the worker, excluding the transfer hop. */
  readonly workerMs: number;
}

export interface DataClient {
  generate(options: GenerateOptions): Promise<GeneratedDataset>;
  /** Rejects every pending request and terminates the worker. */
  dispose(): void;
}

interface Pending {
  resolve(dataset: GeneratedDataset): void;
  reject(error: Error): void;
}

/**
 * Promise-based client over the worker. Every request gets an id, so responses can arrive in any
 * order. Callers that care only about the latest request (e.g. a size selector) compare ids or
 * ignore settled promises; the client itself never drops a response silently.
 */
export function createDataClient(worker: WorkerLike): DataClient {
  let nextId = 1;
  const pending = new Map<number, Pending>();

  const rejectAll = (error: Error): void => {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };

  worker.addEventListener('message', (event) => {
    const response = event.data;
    const request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id);
    if (response.type === 'error') {
      request.reject(new Error(response.message));
    } else {
      request.resolve({
        observations: response.observations,
        stations: response.stations,
        series: response.series,
        workerMs: response.elapsedMs,
      });
    }
  });

  worker.addEventListener('error', (event) => {
    rejectAll(new Error(`Data worker failed: ${event.message}`));
  });

  return {
    generate(options) {
      const id = nextId++;
      return new Promise<GeneratedDataset>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, type: 'generate', options });
      });
    },
    dispose() {
      rejectAll(new Error('Data client disposed'));
      worker.terminate();
    },
  };
}
