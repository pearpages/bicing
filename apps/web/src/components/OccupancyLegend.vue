<script setup lang="ts">
import { computed, useId } from 'vue';
import { useI18n } from '../i18n/useI18n';
import classes from './OccupancyLegend.module.scss';

const props = defineProps<{ stops: readonly string[] }>();
const gradientId = useId();
const { t } = useI18n();
const offsets = computed(() =>
  props.stops.map((color, i) => ({
    color,
    offset: `${((i / Math.max(1, props.stops.length - 1)) * 100).toFixed(0)}%`,
  })),
);
</script>

<template>
  <div :class="classes.legend">
    <span :class="classes.title">{{ t.legend.title }}</span>
    <div :class="classes.scale">
      <span :class="classes.end">{{ t.legend.emptier }}</span>
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
      <span :class="classes.end">{{ t.legend.fuller }}</span>
    </div>
  </div>
</template>
