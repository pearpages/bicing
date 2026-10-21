<script setup lang="ts">
import type {
  TimeSeriesChart as ChartController,
  Decimation,
  FrameReport,
  RendererKind,
} from '@bicing/charts';
import { chartFormat } from '@bicing/charts';
import { TimeSeriesChart } from '@bicing/vue';
import { computed, onMounted, ref, shallowRef, watch } from 'vue';
import classes from './App.module.scss';
import { configLabel } from './benchmark/results';
import { useBenchmarkRun } from './benchmark/useBenchmarkRun';
import { usePerfMonitor } from './benchmark/usePerfMonitor';
import OccupancyLegend from './components/OccupancyLegend.vue';
import FilterPanel from './components/FilterPanel.vue';
import PerfPanel from './components/PerfPanel.vue';
import StationMapPanel from './components/StationMapPanel.vue';
import ResultsDialog from './components/ResultsDialog.vue';
import MonthSelect from './components/MonthSelect.vue';
import SegmentedControl from './components/SegmentedControl.vue';
import { useControlOptions } from './controls/useControlOptions';
import { useDataset } from './data/useDataset';
import { useDatasetText } from './data/useDatasetText';
import { useDataSource } from './data/useDataSource';
import { useDescribeHit } from './data/describeHit';
import { monthRange } from './data/monthRange';
import { useFilters } from './data/useFilters';
import { useGaps } from './data/useGaps';
import { useMapMoment } from './data/useMapMoment';
import { useHistoryView } from './data/useHistoryView';
import { chartLocale } from './i18n/chartLocale';
import { useI18n } from './i18n/useI18n';
import { occupancyScale, rampStops, useColorScheme } from './theme';

const { locale, t, fmt, setLocale } = useI18n();
const options = useControlOptions();
const language = computed({ get: () => locale.value, set: setLocale });
const chartText = computed(() => chartLocale(locale.value, t.value));
const formatTime = computed(() => chartFormat(chartText.value).time);

const renderer = ref<RendererKind>('webgl');
const decimation = ref<Decimation>('none');
const { kind: sourceKind, rows, month, history, realMonths, source } = useDataSource();

const dataset = useDataset();
const historyView = useHistoryView(dataset, history);
const { gaps } = useGaps(sourceKind);
const describe = useDescribeHit(dataset);
const filters = useFilters(dataset.current, (request) => dataset.filter(request));
const mapMoment = useMapMoment(dataset);
// A month spans its calendar month, so a late start or an early end shows as a shaded gap (T2.6);
// the whole history spans its coverage at every level (T2.5b).
const chartExtent = computed(() => {
  const loaded = dataset.source.value;
  if (loaded?.kind === 'real') return monthRange(loaded.month);
  return dataset.current.value?.view?.extent;
});
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

function onView(view: readonly [number, number]): void {
  historyView.onView(view);
  mapMoment.onChartView(view);
}

function onFrame(report: FrameReport): void {
  perf.recordFrame(report);
  if (report.uploadedPoints > 0 || report.skipped) dataset.markFirstFrame();
}

// Typed structurally: the component exposes its controller as `chart` (see @bicing/vue).
const chartView = shallowRef<{ chart: ChartController | null } | null>(null);

const { benchmark, resultsOpen, measuring, measureCurrent, measureAll } = useBenchmarkRun({
  renderer,
  decimation,
  sourceKind,
  rows,
  dataset,
  monitor: perf.monitor,
  chart: () => chartView.value?.chart ?? null,
});

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
            :extent="chartExtent"
            :keep-view="dataset.source.value?.kind === 'history'"
            :gaps="gaps"
            :brush-enabled="filters.enabled.value"
            :brush="filters.time.value"
            :dimmed-stations="filters.dimmedStations.value"
            @brush="filters.time.value = $event"
            @frame="onFrame"
            @view="onView"
            @hover="mapMoment.onChartHover"
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

      <div :class="classes.sidebar">
        <StationMapPanel
          :series="series"
          :stations="dataset.current.value?.stations ?? null"
          :moment="mapMoment.moment.value"
          :color-scale="colorScale"
          :format-time="formatTime"
          :dimmed-stations="filters.dimmedStations.value"
          :extent="mapMoment.extent.value"
          :playing="mapMoment.playing.value"
          :pinned="mapMoment.pinned.value"
          @select="filters.toggleStation"
          @scrub="mapMoment.scrub"
          @play="mapMoment.play"
          @pause="mapMoment.pause"
          @follow="mapMoment.follow"
        />
        <FilterPanel
          v-if="dataset.current.value"
          :enabled="filters.enabled.value"
          :active="filters.active.value"
          :totals="filters.totals.value"
          :result="filters.result.value"
          :hour="filters.hour.value"
          :fill="filters.fill.value"
          :stations-picked="filters.stations.value?.length ?? 0"
          @update:hour="filters.hour.value = $event"
          @update:fill="filters.fill.value = $event"
          @clear="filters.clear"
        />
        <PerfPanel
          :snapshot="perf.snapshot.value"
          :report="perf.report.value"
          :timing="dataset.timing.value"
        />
      </div>
    </main>

    <ResultsDialog
      :open="resultsOpen"
      :results="benchmark.results.value"
      :markdown="benchmark.markdown.value"
      @close="resultsOpen = false"
    />
  </div>
</template>
