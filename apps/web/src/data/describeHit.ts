import type { ChartFormat, Hit } from '@bicing/charts';
import { useI18n } from '../i18n/useI18n';
import type { Dataset } from './useDataset';

/** The tooltip for a hovered reading: the station's name, the time and the bikes (P27). */
export function useDescribeHit(dataset: Dataset) {
  const { t } = useI18n();
  return (hit: Hit, format: ChartFormat): readonly string[] => {
    const stations = dataset.current.value?.stations;
    const text = t.value;
    const name = stations?.names[hit.station] ?? text.chart.station(hit.station + 1);
    const capacity = stations?.capacity[hit.station];
    return [
      name,
      format.time(hit.t),
      capacity ? text.tooltip.available(hit.y, capacity) : text.tooltip.availableNoCapacity(hit.y),
    ];
  };
}
