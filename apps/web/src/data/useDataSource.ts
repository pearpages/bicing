import { computed, ref, shallowRef, watch } from 'vue';
import { DEFAULT_ROWS } from './sizes';
import { WHOLE_HISTORY, type DataSource, type HistoryRequest } from './source';
import { useRealMonths } from './useRealMonths';

/** The whole history opens at the daily level over everything (ADR 0014). */
const OPENING_VIEW: HistoryRequest = { level: '1d', t0: 0, t1: 0xffff_ffff };

/**
 * The data controls: synthetic with a size, a real month from the manifest (ADR 0013), or the whole
 * history, whose level and window follow the view (`useHistoryView` sets `history`).
 */
export function useDataSource() {
  const kind = ref<DataSource['kind'] & ('synthetic' | 'real')>('synthetic');
  const rows = ref(DEFAULT_ROWS);
  /** A `YYYY-MM`, or `WHOLE_HISTORY`. */
  const month = ref<string | null>(null);
  const history = shallowRef<HistoryRequest | null>(null);
  const realMonths = useRealMonths();
  // Null while the month list is still on its way: there's nothing to load yet.
  const source = computed<DataSource | null>(() => {
    if (kind.value === 'synthetic') return { kind: 'synthetic', rows: rows.value };
    if (month.value === WHOLE_HISTORY)
      return { kind: 'history', ...(history.value ?? OPENING_VIEW) };
    return month.value === null ? null : { kind: 'real', month: month.value };
  });
  // The manifest is fetched the first time someone picks real data, and opens on the latest month.
  watch(kind, async (next) => {
    if (next === 'real') month.value ??= await realMonths.latest();
  });
  // Leaving the whole history forgets its view, so coming back opens at the daily level again.
  watch(month, (next) => {
    if (next !== WHOLE_HISTORY) history.value = null;
  });
  return { kind, rows, month, history, realMonths, source };
}
