<script setup lang="ts">
import '@bicing/charts/styles.css';
import type { BinRange } from '@bicing/charts';
import { ref, toRef } from 'vue';
import classes from './HistogramChart.module.scss';
import { useHistogramChart } from './useHistogramChart';

const props = defineProps<{
  bins: number;
  label: string;
  tick: (bin: number) => string;
  tickEvery?: number;
  formatNumber?: (n: number) => string;
  total: ArrayLike<number> | null;
  passing: ArrayLike<number> | null;
  brush: BinRange | null;
}>();

const emit = defineEmits<{ brush: [range: BinRange | null] }>();

const host = ref<HTMLElement | null>(null);
useHistogramChart(host, {
  bins: props.bins,
  label: toRef(props, 'label'),
  tick: toRef(props, 'tick'),
  ...(props.tickEvery === undefined ? {} : { tickEvery: props.tickEvery }),
  formatNumber: toRef(props, 'formatNumber'),
  total: toRef(props, 'total'),
  passing: toRef(props, 'passing'),
  brush: toRef(props, 'brush'),
  onBrush: (range) => {
    emit('brush', range);
  },
});
</script>

<template>
  <div ref="host" :class="classes.host" />
</template>
