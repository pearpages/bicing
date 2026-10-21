import type { FilterRequest, FilterResult, GeneratedDataset } from '@bicing/data';
import { describe, expect, test } from 'vitest';
import { effectScope, nextTick, shallowRef } from 'vue';
import { useFilters } from './useFilters';

/** Only `generation` matters to the filters. */
const dataset = (generation: number | null) => ({ generation }) as unknown as GeneratedDataset;

/** A worker that answers when the test says so, with station counts the test chooses. */
function fakeWorker() {
  const requests: { request: FilterRequest; resolve: (r: FilterResult) => void }[] = [];
  const filter = (request: FilterRequest) =>
    new Promise<FilterResult>((resolve) => requests.push({ request, resolve }));
  const answer = (stations: number[]) => {
    const pending = requests.shift();
    if (!pending) throw new Error('no request to answer');
    const passing = stations.reduce((a, b) => a + b, 0);
    pending.resolve({
      generation: pending.request.generation,
      hour: Uint32Array.of(passing),
      fill: Uint32Array.of(passing),
      stations: Uint32Array.from(stations),
      passing,
      rows: 100,
    });
    return pending.request;
  };
  return { filter, requests, answer };
}

function setup(generation: number | null = 1) {
  const current = shallowRef<GeneratedDataset | null>(dataset(generation));
  const worker = fakeWorker();
  const scope = effectScope();
  const filters = scope.run(() => useFilters(current, worker.filter));
  if (!filters) throw new Error('no filters');
  return { current, worker, filters };
}

const settle = async () => {
  await Promise.resolve();
  await nextTick();
};

describe('useFilters', () => {
  test('a new dataset asks for the unfiltered counts: the totals, and nothing dims', async () => {
    const { worker, filters } = setup();
    expect(worker.requests[0]?.request).toMatchObject({ generation: 1, time: null, hour: null });
    worker.answer([3, 4]);
    await settle();
    expect(Array.from(filters.totals.value?.hour ?? [])).toEqual([7]);
    expect(filters.result.value?.passing).toBe(7);
    expect(filters.dimmedStations.value).toBeNull();
  });

  test('a brush sends the whole selection, and stations with nothing passing dim', async () => {
    const { worker, filters } = setup();
    worker.answer([3, 4]);
    await settle();
    filters.hour.value = [7, 10];
    filters.fill.value = [0, 4];
    await nextTick();
    // Both changes in one tick: one request.
    expect(worker.requests).toHaveLength(1);
    expect(worker.answer([0, 2])).toMatchObject({ hour: [7, 10], fill: [0, 4], time: null });
    await settle();
    expect(Array.from(filters.dimmedStations.value ?? [])).toEqual([1, 0]);
    // The totals stay those of the unfiltered data.
    expect(Array.from(filters.totals.value?.hour ?? [])).toEqual([7]);
  });

  test('map clicks toggle stations; an empty-map click and "clear" reset', async () => {
    const { filters } = setup();
    filters.toggleStation(2);
    filters.toggleStation(5);
    expect(filters.stations.value).toEqual([2, 5]);
    filters.toggleStation(2);
    expect(filters.stations.value).toEqual([5]);
    filters.toggleStation(null);
    expect(filters.stations.value).toBeNull();
    filters.toggleStation(1);
    filters.hour.value = [1, 2];
    expect(filters.active.value).toBe(true);
    filters.clear();
    expect(filters.active.value).toBe(false);
    await nextTick();
  });

  test('a new dataset resets the selection, and late answers for the old one are dropped', async () => {
    const { current, worker, filters } = setup();
    worker.answer([3, 4]);
    await settle();
    filters.hour.value = [7, 10];
    await nextTick();
    current.value = dataset(2);
    await nextTick();
    expect(filters.hour.value).toBeNull();
    // The answer to the old brush arrives after the new load: ignored.
    worker.answer([0, 1]);
    await settle();
    expect(filters.result.value).toBeNull();
    expect(worker.requests.at(-1)?.request.generation).toBe(2);
  });

  test('a dataset that cannot be filtered sends nothing and ignores map clicks', () => {
    const { worker, filters } = setup(null);
    filters.toggleStation(3);
    expect(filters.enabled.value).toBe(false);
    expect(filters.stations.value).toBeNull();
    expect(worker.requests).toHaveLength(0);
  });
});
