import type { BinRange, TimeRange } from '@bicing/charts';
import type { FilterRequest, FilterResult, GeneratedDataset } from '@bicing/data';
import { computed, shallowRef, watch, type Ref } from 'vue';

/** The User Timing measure each filter update records; a benchmark or DevTools can read it. */
export const FILTER_MEASURE = 'bicing:filter';

export interface FilterCounts {
  readonly hour: Uint32Array;
  readonly fill: Uint32Array;
}

/**
 * The linked views' state (T3.4, ADR 0015): one selection per dimension, kept on the page, and
 * the counts the worker returns for them. Every change sends the whole selection; the client
 * keeps one request in flight and sends only the latest after it, so a fast brush never queues.
 */
export function useFilters(
  current: Readonly<Ref<GeneratedDataset | null>>,
  filter: (request: FilterRequest) => Promise<FilterResult>,
) {
  const time = shallowRef<TimeRange | null>(null);
  const hour = shallowRef<BinRange | null>(null);
  const fill = shallowRef<BinRange | null>(null);
  const stations = shallowRef<readonly number[] | null>(null);
  /** The histograms with no filter: the faint bars under the selection. */
  const totals = shallowRef<FilterCounts | null>(null);
  const result = shallowRef<FilterResult | null>(null);

  const generation = computed(() => current.value?.generation ?? null);
  const enabled = computed(() => generation.value !== null);
  const active = computed(
    () =>
      time.value !== null || hour.value !== null || fill.value !== null || stations.value !== null,
  );

  /** One flag per station, 1 = no reading passes. Null when nothing is filtered: nothing dims. */
  const dimmedStations = computed(() => {
    const counts = result.value?.stations;
    if (!active.value || !counts) return null;
    const dimmed = new Uint8Array(counts.length);
    for (let s = 0; s < counts.length; s++) dimmed[s] = counts[s] === 0 ? 1 : 0;
    return dimmed;
  });

  function send(gen: number, onResult: (result: FilterResult) => void): void {
    const sent = performance.now();
    const request: FilterRequest = {
      generation: gen,
      time: time.value,
      hour: hour.value,
      fill: fill.value,
      stations: stations.value,
    };
    filter(request).then(
      (next) => {
        // Answers for a dataset that's since been replaced are dropped.
        if (next.generation !== generation.value) return;
        onResult(next);
        // Brush latency as User Timing (T3.7): from the brush move to its counts on the page,
        // with the worker's share. A move that was overtaken waits for the newer answer, and
        // that wait is part of what the person feels, so it's counted.
        performance.measure(FILTER_MEASURE, {
          start: sent,
          end: performance.now(),
          detail: { workerMs: next.workerMs },
        });
      },
      (error: unknown) => {
        // A load overtook the request and the worker refused it: expected, nothing to show.
        if (gen === generation.value) throw error;
      },
    );
  }

  function clear(): void {
    time.value = null;
    hour.value = null;
    fill.value = null;
    stations.value = null;
  }

  watch(
    generation,
    (gen) => {
      clear();
      totals.value = null;
      result.value = null;
      // Unfiltered counts first: they're the totals the histograms draw under the selection.
      if (gen !== null) {
        send(gen, (next) => {
          totals.value = { hour: next.hour, fill: next.fill };
          result.value ??= next;
        });
      }
    },
    { immediate: true },
  );
  watch([time, hour, fill, stations], () => {
    const gen = generation.value;
    if (gen !== null) {
      send(gen, (next) => {
        result.value = next;
      });
    }
  });

  return {
    enabled,
    active,
    time,
    hour,
    fill,
    stations,
    totals,
    result,
    dimmedStations,
    /** A click on the map toggles that station; a click on empty map clears the station selection. */
    toggleStation(station: number | null): void {
      if (!enabled.value) return;
      if (station === null) {
        stations.value = null;
        return;
      }
      const picked = stations.value ?? [];
      const next = picked.includes(station)
        ? picked.filter((s) => s !== station)
        : [...picked, station];
      stations.value = next.length > 0 ? next : null;
    },
    clear,
  };
}
