<script setup lang="ts">
import '@bicing/charts/styles.css';
import type {
  ChartFormat,
  ChartLocale,
  Decimation,
  FrameReport,
  GapPeriod,
  Hit,
  RendererKind,
  TimeRange,
} from '@bicing/charts';
import type { StationSeries } from '@bicing/core';
import { ref, toRef } from 'vue';
import classes from './TimeSeriesChart.module.scss';
import { useTimeSeriesChart } from './useTimeSeriesChart';

const props = withDefaults(
  defineProps<{
    series: StationSeries | null;
    renderer?: RendererKind;
    decimation?: Decimation;
    colorScale?: (t: number) => string;
    alpha?: number;
    locale: ChartLocale;
    extent?: readonly [number, number] | undefined;
    keepView?: boolean;
    gaps?: readonly GapPeriod[] | undefined;
    describe?: (hit: Hit, format: ChartFormat) => readonly string[];
    brushEnabled?: boolean;
    brush?: TimeRange | null;
    dimmedStations?: Uint8Array | null;
  }>(),
  {
    renderer: 'webgl',
    decimation: 'none',
    colorScale: () => () => 'rgb(42, 120, 214)',
  },
);

const emit = defineEmits<{
  frame: [report: FrameReport];
  hover: [hit: Hit | null];
  view: [domain: readonly [number, number]];
  brush: [range: TimeRange | null];
}>();

const host = ref<HTMLElement | null>(null);
const chart = useTimeSeriesChart(host, {
  series: toRef(props, 'series'),
  renderer: toRef(props, 'renderer'),
  decimation: toRef(props, 'decimation'),
  colorScale: toRef(props, 'colorScale'),
  alpha: toRef(props, 'alpha'),
  locale: toRef(props, 'locale'),
  extent: toRef(props, 'extent'),
  keepView: toRef(props, 'keepView'),
  gaps: toRef(props, 'gaps'),
  brushEnabled: toRef(props, 'brushEnabled'),
  brush: toRef(props, 'brush'),
  dimmedStations: toRef(props, 'dimmedStations'),
  ...(props.describe ? { describe: props.describe } : {}),
  onFrame: (report) => {
    emit('frame', report);
  },
  onHover: (hit) => {
    emit('hover', hit);
  },
  onView: (domain) => {
    emit('view', domain);
  },
  onBrush: (range) => {
    emit('brush', range);
  },
});

// Imperative access (zoomTo, setInteracting) for the scripted benchmark.
defineExpose({ chart });
</script>

<template>
  <div ref="host" :class="classes.host" />
</template>
