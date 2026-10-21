import { onBeforeUnmount, type ShallowRef } from 'vue';
import { needsReload, pickLevel, windowFor, type Domain } from './historyView';
import type { HistoryRequest } from './source';
import type { Dataset } from './useDataset';

/** Waits for the view to settle: a zoom gesture fires dozens of view events. */
const SETTLE_MS = 200;

/**
 * Follows the chart's view while the whole history is shown, and asks for another level or window
 * when the settled view needs one (T2.5b). The dataset keeps drawing the old one meanwhile.
 */
export function useHistoryView(dataset: Dataset, history: ShallowRef<HistoryRequest | null>) {
  let timer: ReturnType<typeof setTimeout> | undefined;

  function settle(view: Domain): void {
    const loaded = dataset.current.value?.view;
    if (dataset.source.value?.kind !== 'history' || !loaded || !needsReload(loaded, view)) return;
    const level = pickLevel(view[1] - view[0]);
    const [t0, t1] = windowFor(level, view, loaded.extent);
    history.value = { level, t0, t1 };
  }

  function onView(view: Domain): void {
    clearTimeout(timer);
    timer = setTimeout(() => {
      settle(view);
    }, SETTLE_MS);
  }

  onBeforeUnmount(() => {
    clearTimeout(timer);
  });

  return { onView };
}
