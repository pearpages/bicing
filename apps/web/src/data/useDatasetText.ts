import { computed, type Ref } from 'vue';
import { loadErrorText } from '../i18n/loadError';
import { useI18n } from '../i18n/useI18n';
import { DATA_BASE_URL, type DataSource } from './source';
import type { Dataset } from './useDataset';
import type { RealMonths } from './useRealMonths';

/** The header's summary and the chart's loading and error lines, in the active language (P27). */
export function useDatasetText(
  dataset: Dataset,
  kind: Readonly<Ref<DataSource['kind']>>,
  realMonths: RealMonths,
) {
  const { t, fmt } = useI18n();
  const summary = computed(() => {
    const data = dataset.current.value;
    if (!data) return null;
    const { app } = t.value;
    const { int, month } = fmt.value;
    const readings = int(data.series.x.length);
    const stations = int(data.stations.length);
    const loaded = dataset.source.value;
    if (loaded?.kind === 'real') return app.realSummary(readings, stations, month(loaded.month));
    const days = (data.series.xMax - data.series.xMin) / 1_440;
    return app.summary(
      readings,
      stations,
      days < 2 ? app.hours(int(days * 24)) : app.days(int(days)),
    );
  });
  const error = computed(() => {
    const failure = dataset.error.value;
    if (failure) return loadErrorText(failure, t.value, fmt.value);
    return kind.value === 'real' && realMonths.unavailable.value
      ? t.value.app.realUnavailable(DATA_BASE_URL)
      : null;
  });
  const loading = computed(() => {
    const pending = dataset.loading.value;
    if (pending === null) return null;
    return pending.kind === 'synthetic'
      ? t.value.app.generating(fmt.value.int(pending.rows))
      : t.value.app.loadingMonth(fmt.value.month(pending.month));
  });
  return { summary, error, loading };
}
