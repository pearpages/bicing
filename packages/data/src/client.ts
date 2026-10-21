import type { ObservationColumns, StationSeries, StationTable } from '@bicing/core';
import type { GenerateOptions } from '@bicing/synthetic';
import type { LoadOptions } from './load';
import type { FilterRequest, FilterResult } from './filters';
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
  /** For `filter` requests; `null` when the dataset can't be filtered (ADR 0015). */
  readonly generation: number | null;
  /** Generation or loading + series building inside the worker, excluding the transfer hop. */
  readonly workerMs: number;
}

export interface DataClient {
  generate(options: GenerateOptions): Promise<GeneratedDataset>;
  /** Real data: Parquet months from a base URL (ADR 0013). */
  load(options: LoadOptions): Promise<GeneratedDataset>;
  /** One level of the whole history over a window (T2.5b, ADR 0014). */
  view(options: ViewOptions): Promise<GeneratedDataset>;
  /**
   * Brush positions for the latest dataset (ADR 0015). One update is in flight at a time: newer
   * filters replace a queued one, and every caller still waiting gets the newest answer.
   */
  filter(filters: FilterRequest): Promise<FilterResult>;
  /** Rejects every pending request and terminates the worker. */
  dispose(): void;
}

type Settle = (response: WorkerResponse | Error) => void;

/**
 * Promise-based client over the worker. Every request gets an id, so responses can arrive in any
 * order. Callers that care only about the latest request (e.g. a size selector) compare ids or
 * ignore settled promises; the client itself never drops a response silently.
 */
export function createDataClient(worker: WorkerLike): DataClient {
  let nextId = 1;
  const pending = new Map<number, Settle>();

  const rejectAll = (error: Error): void => {
    for (const settle of pending.values()) settle(error);
    pending.clear();
  };

  worker.addEventListener('message', (event) => {
    const response = event.data;
    const settle = pending.get(response.id);
    if (!settle) return;
    pending.delete(response.id);
    settle(response);
  });

  worker.addEventListener('error', (event) => {
    rejectAll(new Error(`Data worker failed: ${event.message}`));
  });

  const post = (request: WorkerRequest): Promise<WorkerResponse> =>
    new Promise((resolve, reject) => {
      pending.set(request.id, (response) => {
        if (response instanceof Error) reject(response);
        else if (response.type === 'error') reject(new Error(response.message));
        else resolve(response);
      });
      worker.postMessage(request);
    });

  const send = async (request: (id: number) => WorkerRequest): Promise<GeneratedDataset> => {
    const response = await post(request(nextId++));
    if (response.type !== 'dataset') throw new Error(`Expected a dataset, got ${response.type}`);
    return {
      observations: response.observations,
      stations: response.stations,
      series: response.series,
      rows: response.rows,
      view: response.view,
      generation: response.generation,
      workerMs: response.elapsedMs,
    };
  };

  // One filter update in flight; while it runs, only the latest brush position waits (ADR 0015).
  let filtering = false;
  let queued: {
    filters: FilterRequest;
    waiters: { resolve: (r: FilterResult) => void; reject: (e: Error) => void }[];
  } | null = null;
  const sendFilter = (filters: FilterRequest, waiters: NonNullable<typeof queued>['waiters']) => {
    filtering = true;
    post({ id: nextId++, type: 'filter', filters })
      .then(
        (response) => {
          if (response.type === 'filtered') for (const w of waiters) w.resolve(response.result);
          else
            for (const w of waiters)
              w.reject(new Error(`Expected filter counts, got ${response.type}`));
        },
        (error: unknown) => {
          for (const w of waiters)
            w.reject(error instanceof Error ? error : new Error(String(error)));
        },
      )
      .finally(() => {
        filtering = false;
        const next = queued;
        queued = null;
        if (next) sendFilter(next.filters, next.waiters);
      });
  };

  return {
    generate: (options) => send((id) => ({ id, type: 'generate', options })),
    load: (options) => send((id) => ({ id, type: 'load', options })),
    view: (options) => send((id) => ({ id, type: 'view', options })),
    filter: (filters) =>
      new Promise<FilterResult>((resolve, reject) => {
        const waiter = { resolve, reject };
        if (!filtering) {
          sendFilter(filters, [waiter]);
          return;
        }
        // Superseded positions get the newest answer: by then they're out of date anyway.
        queued = { filters, waiters: [...(queued?.waiters ?? []), waiter] };
      }),
    dispose() {
      rejectAll(new Error('Data client disposed'));
      worker.terminate();
    },
  };
}
