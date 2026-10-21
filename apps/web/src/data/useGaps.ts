import type { GapPeriod } from '@bicing/charts';
import { fetchGaps, type GapCatalog } from '@bicing/data';
import { computed, shallowRef, watch, type Ref } from 'vue';
import { useI18n } from '../i18n/useI18n';
import { monthRange } from './monthRange';
import { DATA_BASE_URL, type DataSource } from './source';

/**
 * The feed-wide gaps from `gaps.json` (T2.6), for real data only. A gap that covers a month the
 * catalogue never published, or published with the wrong file (ADR 0012), says so.
 */
export function useGaps(kind: Readonly<Ref<DataSource['kind']>>) {
  const { t, fmt } = useI18n();
  const catalog = shallowRef<GapCatalog | null>(null);
  let requested = false;

  // Fetched once, the first time real data is picked. Without it the chart just has no shading.
  watch(
    kind,
    (next) => {
      if (next === 'synthetic' || requested) return;
      requested = true;
      fetchGaps(DATA_BASE_URL).then(
        (found) => (catalog.value = found),
        () => (requested = false),
      );
    },
    { immediate: true },
  );

  const gaps = computed<readonly GapPeriod[]>(() => {
    const found = catalog.value;
    if (kind.value === 'synthetic' || !found) return [];
    const reasons = [
      ...found.missingMonths.map((month) => ({ month, note: t.value.app.gapMissing })),
      ...found.unusableMonths.map(({ month }) => ({ month, note: t.value.app.gapUnusable })),
    ].map(({ month, note }) => ({ range: monthRange(month), text: note(fmt.value.month(month)) }));
    return found.gaps.map(({ t0, t1 }) => {
      const notes = reasons
        .filter(({ range }) => range[0] < t1 && range[1] > t0)
        .map(({ text }) => text);
      return notes.length === 0 ? { t0, t1 } : { t0, t1, note: notes.join(' ') };
    });
  });

  return { gaps };
}
