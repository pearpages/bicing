import type { Decimation, RendererKind, TimeSeriesChart } from '@bicing/charts';
import { computed, ref, type Ref } from 'vue';
import type { DataSource } from '../data/source';
import { DatasetError, type Dataset } from '../data/useDataset';
import { waitFrames, waitUntil } from './frames';
import type { PerfMonitor } from './perfMonitor';
import type { BenchmarkConfig } from './results';
import { fullMatrix, useBenchmark } from './useBenchmark';

export interface BenchmarkRunDeps {
  readonly renderer: Ref<RendererKind>;
  readonly decimation: Ref<Decimation>;
  readonly sourceKind: Ref<'synthetic' | 'real'>;
  readonly rows: Ref<number>;
  readonly dataset: Dataset;
  readonly monitor: PerfMonitor;
  readonly chart: () => TimeSeriesChart | null;
}

/** The page's "Measure" buttons and the automation hook, wired to the app's controls (T1.13–T1.15). */
export function useBenchmarkRun(deps: BenchmarkRunDeps) {
  const { dataset } = deps;

  /** Applies a configuration and waits for its first drawn frame. */
  async function configure(config: BenchmarkConfig): Promise<number | null> {
    deps.renderer.value = config.renderer;
    deps.decimation.value = config.decimation;
    // The benchmark matrix is synthetic sizes; real data gets its own benchmarks in T2.8.
    deps.sourceKind.value = 'synthetic';
    deps.rows.value = config.rows;
    await dataset.load({ kind: 'synthetic', rows: config.rows });
    if (dataset.error.value) throw new DatasetError(dataset.error.value);
    await waitUntil(() => dataset.timing.value?.firstChartMs != null, 60_000);
    await waitFrames(2);
    return dataset.timing.value?.firstChartMs ?? null;
  }

  const benchmark = useBenchmark({ configure, chart: deps.chart, monitor: deps.monitor });
  const resultsOpen = ref(false);
  const measuring = computed(() => benchmark.progress.value !== null);

  async function measure(configs: readonly BenchmarkConfig[]): Promise<void> {
    resultsOpen.value = true;
    await benchmark.run(configs);
  }

  /**
   * Loads any source (a month, a year at any level, the whole history) and resolves with its time
   * to first chart: the real-data benchmarks (T2.8, scripts/bench-real-data.mjs).
   */
  async function load(source: DataSource) {
    await dataset.load(source);
    if (dataset.error.value) throw new DatasetError(dataset.error.value);
    await waitUntil(() => dataset.timing.value?.firstChartMs != null, 300_000);
    const timing = dataset.timing.value;
    return {
      firstChartMs: timing?.firstChartMs ?? null,
      workerMs: timing?.workerMs ?? null,
      rows: timing?.rows ?? 0,
      points: dataset.current.value?.series.x.length ?? 0,
    };
  }

  if (import.meta.env.DEV || new URLSearchParams(location.search).has('automation')) {
    // Lets browser automation drive the same runner a person uses (tasks.md T1.15). Production
    // builds opt in with ?automation, so benchmarks can run on minified code.
    Object.assign(window, {
      bicingBenchmark: { run: measure, fullMatrix, load, markdown: () => benchmark.markdown.value },
    });
  }

  return {
    benchmark,
    resultsOpen,
    measuring,
    measureCurrent: (): void => {
      const { renderer, rows, decimation } = deps;
      void measure([{ renderer: renderer.value, rows: rows.value, decimation: decimation.value }]);
    },
    measureAll: (): void => {
      void measure(fullMatrix());
    },
  };
}
