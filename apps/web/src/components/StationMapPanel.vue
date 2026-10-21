<script setup lang="ts">
import { fillAt, type StationSeries, type StationTable } from '@bicing/core';
import { StationMap } from '@bicing/vue';
import { computed } from 'vue';
import { useI18n } from '../i18n/useI18n';
import classes from './StationMapPanel.module.scss';

const props = defineProps<{
  series: StationSeries | null;
  stations: StationTable | null;
  moment: number | null;
  colorScale: (t: number) => string;
  /** The chart's own time format, so the map writes a moment exactly as the chart's tooltip does. */
  formatTime: (t: number) => string;
  /** One flag per station, 1 = filtered out (T3.4). */
  dimmedStations?: Uint8Array | null;
}>();

const emit = defineEmits<{ select: [station: number | null] }>();

const { t } = useI18n();

// One binary search per station: cheap enough to redo on every crosshair move (T2.7).
const values = computed(() => {
  const { series, stations, moment } = props;
  return series && stations && moment !== null ? fillAt(series, stations.capacity, moment) : null;
});

const caption = computed(() =>
  props.moment === null ? t.value.map.title : t.value.map.at(props.formatTime(props.moment)),
);

/** Rebuilt when the moment or the language changes, so the map refreshes its tooltip. */
const describe = computed(() => {
  const text = t.value;
  // Read here so a new language rebuilds the function (and the map's tooltip).
  const formatTime = props.formatTime;
  const at = props.moment === null ? '' : formatTime(props.moment);
  const fills = values.value;
  return (station: number): readonly string[] => {
    const stations = props.stations;
    const name = stations?.names[station] ?? text.chart.station(station + 1);
    const capacity = stations?.capacity[station] ?? 0;
    const fill = fills?.[station];
    const state =
      fill === undefined || Number.isNaN(fill)
        ? text.map.noData
        : text.tooltip.available(Math.round(fill * capacity), capacity);
    return [name, at, state];
  };
});
</script>

<template>
  <section :class="classes.panel" :aria-label="t.map.title">
    <h2 :class="classes.caption">{{ caption }}</h2>
    <div :class="classes.map">
      <StationMap
        :stations="stations"
        :values="values"
        :label="caption"
        :describe="describe"
        :color-scale="colorScale"
        :dimmed-stations="dimmedStations ?? null"
        @select="emit('select', $event)"
      />
    </div>
    <p :class="classes.legend">
      <span :class="classes.noData" aria-hidden="true" />{{ t.map.noDataLegend }}
    </p>
  </section>
</template>
