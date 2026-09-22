<script setup lang="ts">
import type { Decimation, FrameReport, Hit, RendererKind } from '@bicing/charts';
import { toEpochMs } from '@bicing/core';
import { TimeSeriesChart } from '@bicing/vue';
import { computed, onMounted, ref, watch } from 'vue';
import classes from './App.module.scss';
import { usePerfMonitor } from './benchmark/usePerfMonitor';
import OccupancyLegend from './components/OccupancyLegend.vue';
import PerfPanel from './components/PerfPanel.vue';
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
        />
        <SegmentedControl
          v-model="rows"
          legend="Readings"
          name="rows"
          :options="sizeOptions"
          :disabled="dataset.loading.value !== null"
        />
        <SegmentedControl
          v-model="decimation"
          legend="Downsampling"
          name="decimation"
          :options="decimationOptions"
        />
      </div>
    </header>

    <main :class="classes.main">
      <section :class="classes.chartArea" aria-label="Bikes available per station">
        <div :class="classes.chart">
          <TimeSeriesChart
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
  </div>
</template>
