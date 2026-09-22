<script setup lang="ts">
import { computed } from 'vue';
import { FRAME_BUDGET_MS } from '../benchmark/perfMonitor';
import classes from './FrameTrace.module.scss';

const props = defineProps<{ trace: Float64Array }>();

const WIDTH = 240;
const HEIGHT = 72;
/** Frames above this are clipped to the top edge (and counted as long frames elsewhere). */
const CEILING_MS = 50;

const y = (ms: number) => HEIGHT - (Math.min(ms, CEILING_MS) / CEILING_MS) * HEIGHT;
const budgetY = y(FRAME_BUDGET_MS);

const points = computed(() => {
  const n = props.trace.length;
  if (n === 0) return '';
  const step = WIDTH / Math.max(1, n - 1);
  let out = '';
  for (let i = 0; i < n; i++)
    out += `${(i * step).toFixed(1)},${y(props.trace[i] ?? 0).toFixed(1)} `;
  return out;
});

const overBudget = computed(() => {
  let count = 0;
  for (const ms of props.trace) if (ms > FRAME_BUDGET_MS * 1.5) count++;
  return count;
});
</script>

<template>
  <figure :class="classes.figure">
    <svg
      :class="classes.svg"
      :viewBox="`0 0 ${WIDTH} ${HEIGHT}`"
      preserveAspectRatio="none"
      role="img"
      :aria-label="`Recent frame times; ${overBudget} of the last ${trace.length} frames were over budget`"
    >
      <rect :class="classes.overZone" x="0" y="0" :width="WIDTH" :height="budgetY" />
      <line :class="classes.budget" x1="0" :x2="WIDTH" :y1="budgetY" :y2="budgetY" />
      <polyline :class="classes.line" :points="points" />
    </svg>
    <figcaption :class="classes.caption">
      Frame time, last {{ trace.length }} frames. The line is the 16.7 ms budget for 60 fps.
    </figcaption>
  </figure>
</template>
