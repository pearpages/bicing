import type { ObservationColumns, StationSeries, StationTable } from '@bicing/core';
import type { GenerateOptions } from '@bicing/synthetic';
import type { LoadOptions } from './load';
import type { ViewInfo, WorkerRequest, WorkerResponse } from './protocol';
import type { ViewOptions } from './view';

/** The slice of the Worker API the client uses, so tests can pass a fake. */
export interface WorkerLike {
  postMessage(message: WorkerRequest): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerResponse>) => void): void;
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  terminate(): void;
}

export interface GeneratedDataset {
  /** `null` for an aggregate view. */
  readonly observations: ObservationColumns | null;
  readonly stations: StationTable;
  readonly series: StationSeries;
  /** Readings, or buckets for an aggregate view. */
  readonly rows: number;
  /** Set for a whole-history view (T2.5b). */
  readonly view: ViewInfo | null;
  /** Generation or loading + series building inside the worker, excluding the transfer hop. */
  readonly workerMs: number;
}

export interface DataClient {
  generate(options: GenerateOptions): Promise<GeneratedDataset>;
  /** Real data: Parquet months from a base URL (ADR 0013). */
  load(options: LoadOptions): Promise<GeneratedDataset>;
  /** One level of the whole history over a window (T2.5b, ADR 0014). */
  view(options: ViewOptions): Promise<GeneratedDataset>;
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
        rows: response.rows,
        view: response.view,
        workerMs: response.elapsedMs,
      });
    }
  });

  worker.addEventListener('error', (event) => {
    rejectAll(new Error(`Data worker failed: ${event.message}`));
  });

  const send = (request: (id: number) => WorkerRequest) => {
    const id = nextId++;
    return new Promise<GeneratedDataset>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage(request(id));
    });
  };

  return {
    generate: (options) => send((id) => ({ id, type: 'generate', options })),
    load: (options) => send((id) => ({ id, type: 'load', options })),
    view: (options) => send((id) => ({ id, type: 'view', options })),
    dispose() {
      rejectAll(new Error('Data client disposed'));
      worker.terminate();
    },
  };
}
