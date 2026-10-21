<script setup lang="ts">
import type { BinRange } from '@bicing/charts';
import type { FilterResult } from '@bicing/data';
import { FILL_BINS, HOUR_BINS } from '@bicing/data';
import { HistogramChart } from '@bicing/vue';
import { computed } from 'vue';
import type { FilterCounts } from '../data/useFilters';
import { useI18n } from '../i18n/useI18n';
import classes from './FilterPanel.module.scss';

const props = defineProps<{
  enabled: boolean;
  active: boolean;
  totals: FilterCounts | null;
  result: FilterResult | null;
  hour: BinRange | null;
  fill: BinRange | null;
  stationsPicked: number;
}>();

const emit = defineEmits<{
  'update:hour': [range: BinRange | null];
  'update:fill': [range: BinRange | null];
  clear: [];
}>();

const { t, fmt } = useI18n();

const hourTick = computed(() => (bin: number) => String(bin));
const fillTick = computed(() => {
  const text = t.value.filters;
  const { int } = fmt.value;
  return (bin: number) => text.percent(int((bin * 100) / FILL_BINS));
});
// Up to a few million readings per bin: the full number doesn't fit the sidebar's axis.
const formatNumber = computed(() => fmt.value.compact);

const summary = computed(() => {
  const { result, stationsPicked } = props;
  if (!result) return null;
  const { int } = fmt.value;
  const text = t.value.filters;
  const passing = text.passing(int(result.passing), int(result.rows));
  return stationsPicked > 0 ? `${passing} · ${text.stations(stationsPicked)}` : passing;
});
</script>

<template>
  <section :class="classes.panel" :aria-label="t.filters.title">
    <header :class="classes.header">
      <h2 :class="classes.caption">{{ t.filters.title }}</h2>
      <button
        v-if="enabled"
        type="button"
        :class="classes.clear"
        :disabled="!active"
        @click="emit('clear')"
      >
        {{ t.filters.clear }}
      </button>
    </header>
    <template v-if="enabled">
      <p :class="classes.summary" role="status">{{ summary }}</p>
      <h3 :class="classes.label">{{ t.filters.hour }}</h3>
      <div :class="classes.histogram">
        <HistogramChart
          :bins="HOUR_BINS"
          :label="t.filters.hourLabel"
          :tick="hourTick"
          :tick-every="6"
          :format-number="formatNumber"
          :total="totals?.hour ?? null"
          :passing="result?.hour ?? null"
          :brush="hour"
          @brush="emit('update:hour', $event)"
        />
      </div>
      <h3 :class="classes.label">{{ t.filters.fill }}</h3>
      <div :class="classes.histogram">
        <HistogramChart
          :bins="FILL_BINS"
          :label="t.filters.fillLabel"
          :tick="fillTick"
          :tick-every="5"
          :format-number="formatNumber"
          :total="totals?.fill ?? null"
          :passing="result?.fill ?? null"
          :brush="fill"
          @brush="emit('update:fill', $event)"
        />
      </div>
      <p :class="classes.hint">{{ t.filters.hint }}</p>
    </template>
    <p v-else :class="classes.hint">{{ t.filters.unavailable }}</p>
  </section>
</template>
