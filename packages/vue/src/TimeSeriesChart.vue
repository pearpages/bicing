<script setup lang="ts">
import '@bicing/charts/styles.css';
import type { Decimation, FrameReport, Hit, RendererKind } from '@bicing/charts';
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
    describe?: (hit: Hit) => readonly string[];
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
}>();

const host = ref<HTMLElement | null>(null);
const chart = useTimeSeriesChart(host, {
  series: toRef(props, 'series'),
  renderer: toRef(props, 'renderer'),
  decimation: toRef(props, 'decimation'),
  colorScale: toRef(props, 'colorScale'),
  alpha: toRef(props, 'alpha'),
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
});

// Imperative access (zoomTo, setInteracting) for the scripted benchmark.
defineExpose({ chart });
</script>

<template>
  <div ref="host" :class="classes.host" />
</template>
