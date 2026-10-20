import { createDataClient, createDataWorker, type GeneratedDataset } from '@bicing/data';
import { markRaw, onBeforeUnmount, ref, shallowRef, type Ref, type ShallowRef } from 'vue';
import { SEED } from './sizes';

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
  readonly rows: number;
  /** The worker's own message: developer-facing, so it stays English (ADR 0011). */
  readonly cause: string;
}

/** Thrown by the benchmark's configure step, so a result can say which load failed. */
export class DatasetError extends Error {
  constructor(readonly failure: LoadError) {
    super(`Couldn't generate ${String(failure.rows)} readings: ${failure.cause}`);
  }
}

export interface Dataset {
  readonly current: ShallowRef<GeneratedDataset | null>;
  readonly loading: Ref<number | null>;
  readonly error: Ref<LoadError | null>;
  readonly timing: ShallowRef<LoadTiming | null>;
  load(rows: number): Promise<void>;
  /** Call from the chart's first frame after new data, to close the time-to-first-chart measurement. */
  markFirstFrame(): void;
}

/**
 * Datasets come from the worker (generation and series building off the main thread, buffers transferred)
 * and are held in a shallowRef + markRaw: Vue sees the identity change, never the contents (ADR 0007).
 * Only the latest request wins: clicking 10M and then 1M must not show 10M when it finally arrives.
 */
export function useDataset(): Dataset {
  const client = createDataClient(createDataWorker());
  const current = shallowRef<GeneratedDataset | null>(null);
  const loading = ref<number | null>(null);
  const error = shallowRef<LoadError | null>(null);
  const timing = shallowRef<LoadTiming | null>(null);
  let latest = 0;
  let pendingFirstFrame: { startedAt: number; timing: LoadTiming } | null = null;
  let inFlight: { rows: number; promise: Promise<void> } | null = null;
  let loadedRows: number | null = null;

  /** Idempotent per size: a control's watcher and the benchmark can both ask for the same data. */
  function load(rows: number): Promise<void> {
    if (inFlight?.rows === rows) return inFlight.promise;
    if (!inFlight && loadedRows === rows && current.value) return Promise.resolve();
    const promise = fetchRows(rows).finally(() => {
      if (inFlight?.promise === promise) inFlight = null;
    });
    inFlight = { rows, promise };
    return promise;
  }

  async function fetchRows(rows: number): Promise<void> {
    const request = ++latest;
    const startedAt = performance.now();
    loading.value = rows;
    error.value = null;
    // Drop the previous dataset first: 50M rows next to 10M can exhaust the tab's memory.
    current.value = null;
    loadedRows = null;
    try {
      const dataset = await client.generate({ seed: SEED, rows });
      if (request !== latest) return;
      const loaded: LoadTiming = {
        rows,
        loadMs: performance.now() - startedAt,
        workerMs: dataset.workerMs,
        firstChartMs: null,
      };
      timing.value = loaded;
      pendingFirstFrame = { startedAt, timing: loaded };
      loadedRows = rows;
      current.value = markRaw(dataset);
    } catch (cause) {
      if (request !== latest) return;
      error.value = { rows, cause: cause instanceof Error ? cause.message : String(cause) };
    } finally {
      if (request === latest) loading.value = null;
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

  return { current, loading, error, timing, load, markFirstFrame };
}
