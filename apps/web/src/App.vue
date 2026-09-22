<script setup lang="ts">
import type {
  TimeSeriesChart as ChartController,
  Decimation,
  FrameReport,
  Hit,
  RendererKind,
} from '@bicing/charts';
import { toEpochMs } from '@bicing/core';
import { TimeSeriesChart } from '@bicing/vue';
import { computed, onMounted, ref, shallowRef, watch } from 'vue';
import classes from './App.module.scss';
import { waitFrames, waitUntil } from './benchmark/frames';
import type { BenchmarkConfig } from './benchmark/results';
import { fullMatrix, useBenchmark } from './benchmark/useBenchmark';
import { usePerfMonitor } from './benchmark/usePerfMonitor';
import OccupancyLegend from './components/OccupancyLegend.vue';
import PerfPanel from './components/PerfPanel.vue';
import ResultsDialog from './components/ResultsDialog.vue';
import SegmentedControl, { type Option } from './components/SegmentedControl.vue';
import { DEFAULT_ROWS, SIZE_TIERS } from './data/sizes';
import { useDataset } from './data/useDataset';
import { formatInt } from './format';
import { occupancyScale, rampStops, useColorScheme } from './theme';

const rendererOptions: readonly Option<RendererKind>[] = [
  {
    value: 'svg',
    label: 'SVG',
    title: 'One <path> per line, rebuilt every frame. Capped at 1M points.',
  },
  { value: 'canvas', label: 'Canvas 2D' },
  { value: 'webgl', label: 'WebGL2' },
];
const decimationOptions: readonly Option<Decimation>[] = [
  { value: 'none', label: 'Off' },
  { value: 'minmax', label: 'Min/max per pixel' },
  { value: 'lttb', label: 'LTTB' },
];
const sizeOptions: readonly Option<number>[] = SIZE_TIERS.map((tier) => ({
  value: tier.rows,
  label: tier.label,
  muted: tier.stress === true,
  ...(tier.stress
    ? { title: 'Stress test: about 800 MB in the tab. It may fail on machines with less memory.' }
    : {}),
}));

const renderer = ref<RendererKind>('webgl');
const decimation = ref<Decimation>('none');
const rows = ref(DEFAULT_ROWS);

const dataset = useDataset();
const perf = usePerfMonitor();
const scheme = useColorScheme();
const colorScale = computed(() => occupancyScale(scheme.value));
const stops = computed(() => rampStops(scheme.value));

const series = computed(() => dataset.current.value?.series ?? null);
const summary = computed(() => {
  const data = dataset.current.value;
  if (!data) return null;
  const days = (data.series.xMax - data.series.xMin) / 1_440;
  return `${formatInt(data.series.x.length)} readings from ${formatInt(data.stations.length)} stations over ${
    days < 2 ? `${formatInt(days * 24)} hours` : `${formatInt(days)} days`
  }. Synthetic data with the real schema.`;
});

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
});

function describe(hit: Hit): readonly string[] {
  const stations = dataset.current.value?.stations;
  const name = stations?.names[hit.station] ?? `Station ${String(hit.station + 1)}`;
  const capacity = stations?.capacity[hit.station];
  return [
    name,
    `${dateFormat.format(new Date(toEpochMs(hit.t)))} UTC`,
    capacity
      ? `${String(hit.y)} of ${String(capacity)} bikes available`
      : `${String(hit.y)} bikes available`,
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
  rows.value = config.rows;
  await dataset.load(config.rows);
  if (dataset.error.value) throw new Error(dataset.error.value);
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
  // Lets browser automation drive the same runner a person uses (docs/TASKS.md T1.15). Production
  // builds opt in with ?automation, so benchmarks can run on minified code.
  Object.assign(window, {
    bicingBenchmark: { run: measure, fullMatrix, markdown: () => benchmark.markdown.value },
  });
}

watch(rows, (next) => void dataset.load(next));
// Each configuration is measured on its own; long frames from the last one shouldn't carry over.
watch([renderer, decimation, rows], () => {
  perf.monitor.reset();
});
onMounted(() => void dataset.load(rows.value));
</script>

<template>
  <div :class="classes.app">
    <header :class="classes.header">
      <div :class="classes.titleBlock">
        <h1 :class="classes.title">Bicing Pulse</h1>
        <p :class="classes.summary">
          {{ summary ?? 'Bikes available at every Barcelona Bicing station, over time.' }}
        </p>
      </div>
      <div :class="classes.controls">
        <SegmentedControl
          v-model="renderer"
          legend="Renderer"
          name="renderer"
          :options="rendererOptions"
          :disabled="measuring"
        />
        <SegmentedControl
          v-model="rows"
          legend="Readings"
          name="rows"
          :options="sizeOptions"
          :disabled="dataset.loading.value !== null || measuring"
        />
        <SegmentedControl
          v-model="decimation"
          legend="Downsampling"
          name="decimation"
          :options="decimationOptions"
          :disabled="measuring"
        />
        <div :class="classes.actions">
          <button
            type="button"
            :class="classes.primary"
            :disabled="measuring"
            @click="measureCurrent"
          >
            Measure this setup
          </button>
          <button
            type="button"
            :class="classes.secondary"
            :disabled="measuring"
            @click="measureAll"
          >
            Measure all
          </button>
        </div>
      </div>
      <p v-if="benchmark.progress.value" :class="classes.progress" role="status">
        Measuring {{ benchmark.progress.value.index }} of {{ benchmark.progress.value.total }}:
        {{ benchmark.progress.value.label }}
      </p>
    </header>

    <main :class="classes.main">
      <section :class="classes.chartArea" aria-label="Bikes available per station">
        <div :class="classes.chart">
          <TimeSeriesChart
            ref="chartView"
            :series="series"
            :renderer="renderer"
            :decimation="decimation"
            :color-scale="colorScale"
            :alpha="0.35"
            :describe="describe"
            @frame="onFrame"
          />
          <p v-if="dataset.loading.value !== null" :class="classes.status" role="status">
            Generating {{ formatInt(dataset.loading.value) }} readings in a worker…
          </p>
          <p v-else-if="dataset.error.value" :class="[classes.status, classes.error]" role="alert">
            {{ dataset.error.value }}
          </p>
        </div>
        <footer :class="classes.chartFooter">
          <OccupancyLegend :stops="stops" />
          <span :class="classes.hint">Scroll to zoom, drag to pan, hover for a station.</span>
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
