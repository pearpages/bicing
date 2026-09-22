<script setup lang="ts">
import { computed, useId } from 'vue';
import classes from './OccupancyLegend.module.scss';

const props = defineProps<{ stops: readonly string[] }>();
const gradientId = useId();
const offsets = computed(() =>
  props.stops.map((color, i) => ({
    color,
    offset: `${((i / Math.max(1, props.stops.length - 1)) * 100).toFixed(0)}%`,
  })),
);
</script>

<template>
  <div :class="classes.legend">
    <span :class="classes.title">Line color: average fill of the station</span>
    <div :class="classes.scale">
      <span :class="classes.end">Emptier</span>
      <svg :class="classes.bar" viewBox="0 0 160 8" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient :id="gradientId">
            <stop
              v-for="stop in offsets"
              :key="stop.offset"
              :offset="stop.offset"
              :stop-color="stop.color"
            />
          </linearGradient>
        </defs>
        <rect width="160" height="8" rx="2" :fill="`url(#${gradientId})`" />
      </svg>
      <span :class="classes.end">Fuller</span>
    </div>
  </div>
</template>
