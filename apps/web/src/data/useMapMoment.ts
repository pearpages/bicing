import type { Hit } from '@bicing/charts';
import { computed, shallowRef } from 'vue';
import type { Domain } from './historyView';
import type { Dataset } from './useDataset';

/**
 * The moment the station map shows (T2.7): the time under the chart's crosshair while the pointer
 * is on a line, otherwise the end of the visible range, kept inside the loaded data.
 */
export function useMapMoment(dataset: Dataset) {
  const hovered = shallowRef<number | null>(null);
  const viewEnd = shallowRef<number | null>(null);

  const moment = computed<number | null>(() => {
    const series = dataset.current.value?.series;
    if (!series || series.x.length === 0) return null;
    const t = hovered.value ?? viewEnd.value ?? series.xMax;
    return Math.min(series.xMax, Math.max(series.xMin, t));
  });

  return {
    moment,
    onChartHover(hit: Hit | null): void {
      hovered.value = hit?.t ?? null;
    },
    onChartView(view: Domain): void {
      viewEnd.value = view[1];
    },
  };
}
