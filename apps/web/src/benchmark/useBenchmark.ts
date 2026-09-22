import type { TimeSeriesChart } from '@bicing/charts';
import { computed, ref, shallowRef } from 'vue';
import { waitFrames } from './frames';
import { machineInfo } from './machine';
import type { PerfMonitor } from './perfMonitor';
import { configLabel, toMarkdown, type BenchmarkConfig, type BenchmarkResult } from './results';
import { runScenario } from './runScenario';

export interface BenchmarkDeps {
  /** Applies a configuration and resolves once its first frame is drawn, with the time to first chart. */
  configure(config: BenchmarkConfig): Promise<number | null>;
  chart(): TimeSeriesChart | null;
  readonly monitor: PerfMonitor;
}

/** The matrix for "Measure all". 50M is left out: it's the opt-in stress tier. */
export function fullMatrix(): BenchmarkConfig[] {
  const configs: BenchmarkConfig[] = [];
  for (const rows of [10_000, 100_000, 1_000_000, 10_000_000]) {
    for (const renderer of ['svg', 'canvas', 'webgl'] as const) {
      for (const decimation of ['none', 'minmax'] as const)
        configs.push({ renderer, rows, decimation });
    }
  }
  return configs;
}

export function useBenchmark(deps: BenchmarkDeps) {
  const progress = ref<{ index: number; total: number; label: string } | null>(null);
  const results = shallowRef<readonly BenchmarkResult[]>([]);
  const markdown = computed(() =>
    results.value.length ? toMarkdown(results.value, machineInfo(), new Date()) : '',
  );

  async function run(configs: readonly BenchmarkConfig[]): Promise<void> {
    if (progress.value) return;
    const collected: BenchmarkResult[] = [];
    try {
      for (const [index, config] of configs.entries()) {
        progress.value = { index: index + 1, total: configs.length, label: configLabel(config) };
        collected.push(await measure(config));
        results.value = [...collected];
      }
    } finally {
      progress.value = null;
    }
  }

  async function measure(config: BenchmarkConfig): Promise<BenchmarkResult> {
    try {
      // Background tabs pause requestAnimationFrame completely: the run would never finish.
      if (document.visibilityState !== 'visible') {
        throw new Error(
          'This tab is in the background, so the browser pauses frames. Bring it to the front and run again.',
        );
      }
      const firstChartMs = await deps.configure(config);
      // Let the upload and the first frames settle, so the run measures steady-state interaction.
      await waitFrames(30);
      const chart = deps.chart();
      if (!chart) throw new Error('The chart is not mounted');
      const measurement = await runScenario(chart, deps.monitor);
      return { config, measurement, firstChartMs, error: null };
    } catch (cause) {
      return {
        config,
        measurement: null,
        firstChartMs: null,
        error: cause instanceof Error ? cause.message : String(cause),
      };
    }
  }

  return { progress, results, markdown, run };
}
