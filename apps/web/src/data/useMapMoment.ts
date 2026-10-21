import type { Hit } from '@bicing/charts';
import { computed, onScopeDispose, shallowRef, watch } from 'vue';
import type { Domain } from './historyView';
import { playStep } from './playback';
import type { Dataset } from './useDataset';

export interface FrameClock {
  request(callback: (now: number) => void): number;
  cancel(handle: number): void;
}

const browserClock: FrameClock = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => {
    cancelAnimationFrame(handle);
  },
};

/**
 * The moment the station map shows (T2.7, T3.5): the time under the chart's crosshair while the
 * pointer is on a line; otherwise the one picked with the scrubber; otherwise the end of the
 * visible range. Always kept inside the loaded data.
 */
export function useMapMoment(dataset: Dataset, clock: FrameClock = browserClock) {
  const hovered = shallowRef<number | null>(null);
  const scrubbed = shallowRef<number | null>(null);
  const viewEnd = shallowRef<number | null>(null);
  const playing = shallowRef(false);
  let frame: number | null = null;

  const extent = computed<Domain | null>(() => {
    const series = dataset.current.value?.series;
    return series && series.x.length > 0 ? [series.xMin, series.xMax] : null;
  });

  const moment = computed<number | null>(() => {
    const range = extent.value;
    if (!range) return null;
    const t = hovered.value ?? scrubbed.value ?? viewEnd.value ?? range[1];
    return Math.min(range[1], Math.max(range[0], t));
  });

  function pause(): void {
    playing.value = false;
    if (frame !== null) clock.cancel(frame);
    frame = null;
  }

  function play(): void {
    const range = extent.value;
    const from = moment.value;
    if (!range || from === null) return;
    pause();
    // Playing from the end starts over, as a media player does.
    scrubbed.value = from >= range[1] ? range[0] : from;
    playing.value = true;
    let last: number | null = null;
    const tick = (now: number) => {
      const current = extent.value;
      if (!current || scrubbed.value === null) {
        pause();
        return;
      }
      const step = playStep(scrubbed.value, last === null ? 0 : now - last, current);
      last = now;
      scrubbed.value = step.t;
      if (step.done) pause();
      else frame = clock.request(tick);
    };
    frame = clock.request(tick);
  }

  // New data: stop, and go back to following the view.
  watch(
    () => dataset.current.value,
    () => {
      pause();
      scrubbed.value = null;
    },
  );
  onScopeDispose(pause);

  return {
    moment,
    extent,
    playing,
    /** True while the scrubber has pinned the moment. */
    pinned: computed(() => scrubbed.value !== null),
    onChartHover(hit: Hit | null): void {
      hovered.value = hit?.t ?? null;
    },
    onChartView(view: Domain): void {
      viewEnd.value = view[1];
    },
    scrub(t: number): void {
      pause();
      scrubbed.value = t;
    },
    follow(): void {
      pause();
      scrubbed.value = null;
    },
    play,
    pause,
  };
}
