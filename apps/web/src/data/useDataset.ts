import {
  createDataClient,
  createDataWorker,
  type FilterRequest,
  type FilterResult,
  type GeneratedDataset,
} from '@bicing/data';
import { markRaw, onBeforeUnmount, shallowRef, type Ref, type ShallowRef } from 'vue';
import { SEED } from './sizes';
import { DATA_BASE_URL, sourceKey, type DataSource } from './source';

export interface LoadTiming {
  readonly rows: number;
  /** Click to data on the main thread. */
  readonly loadMs: number;
  /** Generation + series building inside the worker. */
  readonly workerMs: number;
  /** Click to first drawn frame. Filled in by markFirstFrame(). */
  readonly firstChartMs: number | null;
}

/** Kept as data, not a sentence, so the message follows the language when it's shown (P27). */
export interface LoadError {
  readonly source: DataSource;
  /** The worker's own message: developer-facing, so it stays English (ADR 0011). */
  readonly cause: string;
}

/** Thrown by the benchmark's configure step, so a result can say which load failed. */
export class DatasetError extends Error {
  constructor(readonly failure: LoadError) {
    super(`Couldn't load ${sourceKey(failure.source)}: ${failure.cause}`);
  }
}

export interface Dataset {
  readonly current: ShallowRef<GeneratedDataset | null>;
  /** Where `current` came from. */
  readonly source: ShallowRef<DataSource | null>;
  readonly loading: Ref<DataSource | null>;
  readonly error: Ref<LoadError | null>;
  readonly timing: ShallowRef<LoadTiming | null>;
  load(source: DataSource): Promise<void>;
  /** Call from the chart's first frame after new data, to close the time-to-first-chart measurement. */
  markFirstFrame(): void;
  /** Crossfilter counts from the worker (ADR 0015), for a dataset with a generation. */
  filter(request: FilterRequest): Promise<FilterResult>;
}

/**
 * Datasets come from the worker (generation and series building off the main thread, buffers transferred)
 * and are held in a shallowRef + markRaw: Vue sees the identity change, never the contents (ADR 0007).
 * Only the latest request wins: clicking 10M and then 1M must not show 10M when it finally arrives.
 */
export function useDataset(): Dataset {
  const client = createDataClient(createDataWorker());
  const current = shallowRef<GeneratedDataset | null>(null);
  const loadedSource = shallowRef<DataSource | null>(null);
  const loading = shallowRef<DataSource | null>(null);
  const error = shallowRef<LoadError | null>(null);
  const timing = shallowRef<LoadTiming | null>(null);
  let latest = 0;
  let pendingFirstFrame: { startedAt: number; timing: LoadTiming } | null = null;
  let inFlight: { key: string; promise: Promise<void> } | null = null;
  let loadedKey: string | null = null;

  /** Idempotent per source: a control's watcher and the benchmark can both ask for the same data. */
  function load(source: DataSource): Promise<void> {
    const key = sourceKey(source);
    if (inFlight?.key === key) return inFlight.promise;
    if (!inFlight && loadedKey === key && current.value) return Promise.resolve();
    const promise = fetchSource(source, key).finally(() => {
      if (inFlight?.promise === promise) inFlight = null;
    });
    inFlight = { key, promise };
    return promise;
  }

  async function fetchSource(source: DataSource, key: string): Promise<void> {
    const request = ++latest;
    const startedAt = performance.now();
    loading.value = source;
    error.value = null;
    // Drop the previous dataset first: 50M rows next to 10M can exhaust the tab's memory. A
    // whole-history view swapping levels keeps drawing the old one until the new one arrives.
    if (!(source.kind === 'history' && loadedSource.value?.kind === 'history')) {
      current.value = null;
      loadedSource.value = null;
      loadedKey = null;
    }
    try {
      const dataset = await requestFor(source);
      if (request !== latest) return;
      const loaded: LoadTiming = {
        rows: dataset.rows,
        loadMs: performance.now() - startedAt,
        workerMs: dataset.workerMs,
        firstChartMs: null,
      };
      timing.value = loaded;
      pendingFirstFrame = { startedAt, timing: loaded };
      loadedKey = key;
      loadedSource.value = source;
      current.value = markRaw(dataset);
    } catch (cause) {
      if (request !== latest) return;
      error.value = { source, cause: cause instanceof Error ? cause.message : String(cause) };
    } finally {
      if (request === latest) loading.value = null;
    }
  }

  function requestFor(source: DataSource): Promise<GeneratedDataset> {
    switch (source.kind) {
      case 'synthetic':
        return client.generate({ seed: SEED, rows: source.rows });
      case 'real':
        return client.load({ baseUrl: DATA_BASE_URL, months: [source.month] });
      case 'history': {
        const { level, t0, t1 } = source;
        return client.view({ baseUrl: DATA_BASE_URL, level, t0, t1 });
      }
    }
  }

  function markFirstFrame(): void {
    if (!pendingFirstFrame) return;
    const { startedAt, timing: loaded } = pendingFirstFrame;
    pendingFirstFrame = null;
    timing.value = { ...loaded, firstChartMs: performance.now() - startedAt };
  }

  onBeforeUnmount(() => {
    client.dispose();
  });

  return {
    current,
    source: loadedSource,
    loading,
    error,
    timing,
    load,
    markFirstFrame,
    filter: (request) => client.filter(request),
  };
}
