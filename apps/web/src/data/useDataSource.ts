import { computed, ref, watch } from 'vue';
import { DEFAULT_ROWS } from './sizes';
import type { DataSource } from './source';
import { useRealMonths } from './useRealMonths';

/** The data controls: synthetic with a size, or a real month from the manifest (ADR 0013). */
export function useDataSource() {
  const kind = ref<DataSource['kind']>('synthetic');
  const rows = ref(DEFAULT_ROWS);
  const month = ref<string | null>(null);
  const realMonths = useRealMonths();
  // Null while the month list is still on its way: there's nothing to load yet.
  const source = computed<DataSource | null>(() => {
    if (kind.value === 'synthetic') return { kind: 'synthetic', rows: rows.value };
    return month.value === null ? null : { kind: 'real', month: month.value };
  });
  // The manifest is fetched the first time someone picks real data, and opens on the latest month.
  watch(kind, async (next) => {
    if (next === 'real') month.value ??= await realMonths.latest();
  });
  return { kind, rows, month, realMonths, source };
}
