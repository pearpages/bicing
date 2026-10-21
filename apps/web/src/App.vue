<script setup lang="ts">
import type {
  ChartFormat,
  TimeSeriesChart as ChartController,
  Decimation,
  FrameReport,
  Hit,
  RendererKind,
} from '@bicing/charts';
import { TimeSeriesChart } from '@bicing/vue';
import { computed, onMounted, ref, shallowRef, watch } from 'vue';
import classes from './App.module.scss';
import { waitFrames, waitUntil } from './benchmark/frames';
import { configLabel, type BenchmarkConfig } from './benchmark/results';
import { fullMatrix, useBenchmark } from './benchmark/useBenchmark';
import { usePerfMonitor } from './benchmark/usePerfMonitor';
import OccupancyLegend from './components/OccupancyLegend.vue';
import PerfPanel from './components/PerfPanel.vue';
import ResultsDialog from './components/ResultsDialog.vue';
import MonthSelect from './components/MonthSelect.vue';
import SegmentedControl from './components/SegmentedControl.vue';
import { useControlOptions } from './controls/useControlOptions';
import { DatasetError, useDataset } from './data/useDataset';
import { useDatasetText } from './data/useDatasetText';
import { useDataSource } from './data/useDataSource';
import { chartLocale } from './i18n/chartLocale';
import { useI18n } from './i18n/useI18n';
import { occupancyScale, rampStops, useColorScheme } from './theme';

const { locale, t, fmt, setLocale } = useI18n();
const options = useControlOptions();
const language = computed({ get: () => locale.value, set: setLocale });
const chartText = computed(() => chartLocale(locale.value, t.value));

const renderer = ref<RendererKind>('webgl');
const decimation = ref<Decimation>('none');
const { kind: sourceKind, rows, month, realMonths, source } = useDataSource();

const dataset = useDataset();
const perf = usePerfMonitor();
const scheme = useColorScheme();
const colorScale = computed(() => occupancyScale(scheme.value));
const stops = computed(() => rampStops(scheme.value));

const series = computed(() => dataset.current.value?.series ?? null);
const text = useDatasetText(dataset, sourceKind, realMonths);
const progressText = computed(() => {
  const progress = benchmark.progress.value;
  if (!progress) return null;
  const { int } = fmt.value;
  return t.value.controls.progress(
    int(progress.index),
    int(progress.total),
    configLabel(progress.config, t.value.results),
  );
});

function describe(hit: Hit, format: ChartFormat): readonly string[] {
  const stations = dataset.current.value?.stations;
  const text = t.value;
  const name = stations?.names[hit.station] ?? text.chart.station(hit.station + 1);
  const capacity = stations?.capacity[hit.station];
  return [
    name,
    format.time(hit.t),
    capacity ? text.tooltip.available(hit.y, capacity) : text.tooltip.availableNoCapacity(hit.y),
  ];
}

function onFrame(report: FrameReport): void {
  perf.recordFrame(report);
  if (report.uploadedPoints > 0 || report.skipped) dataset.markFirstFrame();
}

// Typed structurally: the component exposes its controller as `chart` (see @bicing/vue).
const chartView = shallowRef<{ chart: ChartController | null } | null>(null);

/** Applies a configuration and waits for its first drawn frame; used by the scripted benchmark. */
async function configure(config: BenchmarkConfig): Promise<number | null> {
  renderer.value = config.renderer;
  decimation.value = config.decimation;
  // The benchmark matrix is synthetic sizes; real data gets its own benchmarks in T2.8.
  sourceKind.value = 'synthetic';
  rows.value = config.rows;
  await dataset.load({ kind: 'synthetic', rows: config.rows });
  if (dataset.error.value) throw new DatasetError(dataset.error.value);
  await waitUntil(() => dataset.timing.value?.firstChartMs != null, 60_000);
  await waitFrames(2);
  return dataset.timing.value?.firstChartMs ?? null;
}

const benchmark = useBenchmark({
  configure,
  chart: () => chartView.value?.chart ?? null,
  monitor: perf.monitor,
});
const resultsOpen = ref(false);
const measuring = computed(() => benchmark.progress.value !== null);

async function measure(configs: readonly BenchmarkConfig[]): Promise<void> {
  resultsOpen.value = true;
  await benchmark.run(configs);
}

function measureCurrent(): void {
  void measure([{ renderer: renderer.value, rows: rows.value, decimation: decimation.value }]);
}

function measureAll(): void {
  void measure(fullMatrix());
}

if (import.meta.env.DEV || new URLSearchParams(location.search).has('automation')) {
  // Lets browser automation drive the same runner a person uses (tasks.md T1.15). Production
  // builds opt in with ?automation, so benchmarks can run on minified code.
  Object.assign(window, {
    bicingBenchmark: { run: measure, fullMatrix, markdown: () => benchmark.markdown.value },
  });
}

watch(source, (next) => {
  if (next) void dataset.load(next);
});
// Each configuration is measured on its own; long frames from the last one shouldn't carry over.
watch([renderer, decimation, source], () => {
  perf.monitor.reset();
});
onMounted(() => {
  if (source.value) void dataset.load(source.value);
});
</script>

<template>
  <div :class="classes.app">
    <header :class="classes.header">
      <div :class="classes.titleBlock">
        <h1 :class="classes.title">{{ t.meta.title }}</h1>
        <p :class="classes.summary">
          {{ text.summary.value ?? t.app.tagline }}
        </p>
      </div>
      <div :class="classes.controls">
        <SegmentedControl
          v-model="renderer"
          :legend="t.controls.renderer"
          name="renderer"
          :options="options.renderer.value"
          :disabled="measuring"
        />
        <SegmentedControl
          v-model="sourceKind"
          :legend="t.controls.source"
          name="source"
          :options="options.source.value"
          :disabled="measuring"
        />
        <SegmentedControl
          v-if="sourceKind === 'synthetic'"
          v-model="rows"
          :legend="t.controls.readings"
          name="rows"
          :options="options.size.value"
          :disabled="dataset.loading.value !== null || measuring"
        />
        <MonthSelect
          v-else-if="realMonths.months.value"
          v-model="month"
          :months="realMonths.months.value"
          :disabled="dataset.loading.value !== null || measuring"
        />
        <SegmentedControl
          v-model="decimation"
          :legend="t.controls.decimation"
          name="decimation"
          :options="options.decimation.value"
          :disabled="measuring"
        />
        <div :class="classes.actions">
          <button
            type="button"
            :class="classes.primary"
            :disabled="measuring || sourceKind === 'real'"
            @click="measureCurrent"
          >
            {{ t.controls.measureThis }}
          </button>
          <button
            type="button"
            :class="classes.secondary"
            :disabled="measuring"
            @click="measureAll"
          >
            {{ t.controls.measureAll }}
          </button>
        </div>
        <SegmentedControl
          v-model="language"
          :legend="t.language.legend"
          name="language"
          :options="options.language"
        />
      </div>
      <p v-if="progressText" :class="classes.progress" role="status">{{ progressText }}</p>
    </header>

    <main :class="classes.main">
      <section :class="classes.chartArea" :aria-label="t.app.chartArea">
        <div :class="classes.chart">
          <TimeSeriesChart
            ref="chartView"
            :series="series"
            :renderer="renderer"
            :decimation="decimation"
            :color-scale="colorScale"
            :alpha="0.35"
            :locale="chartText"
            :describe="describe"
            @frame="onFrame"
          />
          <p v-if="dataset.loading.value !== null" :class="classes.status" role="status">
            {{ text.loading.value }}
          </p>
          <p v-else-if="text.error.value" :class="[classes.status, classes.error]" role="alert">
            {{ text.error.value }}
          </p>
        </div>
        <footer :class="classes.chartFooter">
          <OccupancyLegend :stops="stops" />
          <span :class="classes.hint">{{ t.app.hint }}</span>
        </footer>
      </section>

      <PerfPanel
        :snapshot="perf.snapshot.value"
        :report="perf.report.value"
        :timing="dataset.timing.value"
      />
    </main>

    <ResultsDialog
      :open="resultsOpen"
      :results="benchmark.results.value"
      :markdown="benchmark.markdown.value"
      @close="resultsOpen = false"
    />
  </div>
</template>
