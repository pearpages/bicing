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

export interface Dataset {
  readonly current: ShallowRef<GeneratedDataset | null>;
  readonly loading: Ref<number | null>;
  readonly error: Ref<string | null>;
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
  const error = ref<string | null>(null);
  const timing = shallowRef<LoadTiming | null>(null);
  let latest = 0;
  let pendingFirstFrame: { startedAt: number; timing: LoadTiming } | null = null;

  async function load(rows: number): Promise<void> {
    const request = ++latest;
    const startedAt = performance.now();
    loading.value = rows;
    error.value = null;
    // Drop the previous dataset first: 50M rows next to 10M can exhaust the tab's memory.
    current.value = null;
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
      current.value = markRaw(dataset);
    } catch (cause) {
      if (request !== latest) return;
      error.value = `Couldn't generate ${rows.toLocaleString('en')} readings: ${
        cause instanceof Error ? cause.message : String(cause)
      }. Try a smaller dataset.`;
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
