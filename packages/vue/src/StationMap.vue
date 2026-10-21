<script setup lang="ts">
import '@bicing/charts/styles.css';
import type { StationTable } from '@bicing/core';
import { ref, toRef } from 'vue';
import classes from './StationMap.module.scss';
import { useStationMap } from './useStationMap';

const props = withDefaults(
  defineProps<{
    stations: StationTable | null;
    values: Float32Array | null;
    label: string;
    describe: (station: number) => readonly string[];
    colorScale?: (t: number) => string;
    dimmedStations?: Uint8Array | null;
  }>(),
  { colorScale: () => () => 'rgb(42, 120, 214)' },
);

const emit = defineEmits<{ hover: [station: number | null]; select: [station: number | null] }>();

const host = ref<HTMLElement | null>(null);
useStationMap(host, {
  stations: toRef(props, 'stations'),
  values: toRef(props, 'values'),
  colorScale: toRef(props, 'colorScale'),
  label: toRef(props, 'label'),
  describe: toRef(props, 'describe'),
  dimmedStations: toRef(props, 'dimmedStations'),
  onHover: (station) => {
    emit('hover', station);
  },
  onClick: (station) => {
    emit('select', station);
  },
});
</script>

<template>
  <div ref="host" :class="classes.host" />
</template>
