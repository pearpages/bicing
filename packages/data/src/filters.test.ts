import { Status, type ObservationColumns, type StationTable } from '@bicing/core';
import { generate } from '@bicing/synthetic';
import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { createDataClient, type WorkerLike } from './client';
import { FILL_BINS, FilterState, HOUR_BINS, type FilterRequest } from './filters';
import { createHandler } from './handler';
import type { WorkerRequest, WorkerResponse } from './protocol';

const hourIn = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Madrid',
  hour: 'numeric',
  hourCycle: 'h23',
});
const localHour = (t: number) => Number(hourIn.format(new Date(Date.UTC(2018, 0, 1) + t * 60_000)));

/** The slow way: every row, every filter, from the definitions in ADR 0015. */
function bruteForce(obs: ObservationColumns, stations: StationTable, f: FilterRequest) {
  const hour = new Array<number>(HOUR_BINS).fill(0);
  const fill = new Array<number>(FILL_BINS).fill(0);
  const perStation = new Array<number>(stations.length).fill(0);
  for (let i = 0; i < obs.length; i++) {
    const s = obs.stationIdx[i] ?? 0;
    const capacity = stations.capacity[s] ?? 0;
    if (obs.status[i] !== Status.InService || capacity === 0) continue;
    const t = obs.t[i] ?? 0;
    const h = localHour(t);
    const bikes = (obs.bikesMech[i] ?? 0) + (obs.bikesElec[i] ?? 0);
    const b = Math.min(FILL_BINS - 1, Math.floor((bikes / capacity) * FILL_BINS));
    const inTime = !f.time || (t >= f.time[0] && t < f.time[1]);
    const inHour = !f.hour || (h >= f.hour[0] && h < f.hour[1]);
    const inFill = !f.fill || (b >= f.fill[0] && b < f.fill[1]);
    const inStations = !f.stations || f.stations.includes(s);
    if (inTime && inFill && inStations) hour[h] = (hour[h] ?? 0) + 1;
    if (inTime && inHour && inStations) fill[b] = (fill[b] ?? 0) + 1;
    if (inTime && inHour && inFill && inStations) perStation[s] = (perStation[s] ?? 0) + 1;
  }
  return { hour, fill, stations: perStation };
}

const range = (max: number) =>
  fc
    .option(fc.tuple(fc.integer({ min: 0, max }), fc.integer({ min: 0, max })), { nil: null })
    .map((r) => (r ? ([Math.min(...r), Math.max(...r)] as const) : null));

describe('FilterState', () => {
  // Seeded synthetic data (P19): 4 days of 12 stations, with closures so some rows don't take part.
  const { observations, stations } = generate({ seed: 7, rows: 12 * 288 * 4 });

  test('property: counts match a brute-force filter for any combination of brushes', () => {
    const state = new FilterState(observations, stations, 1);
    const first = observations.t[0] ?? 0;
    const last = observations.t[observations.length - 1] ?? 0;
    fc.assert(
      fc.property(
        range(last - first),
        range(HOUR_BINS),
        range(FILL_BINS),
        fc.option(fc.uniqueArray(fc.integer({ min: 0, max: stations.length - 1 })), { nil: null }),
        (time, hour, fill, picked) => {
          const request: FilterRequest = {
            generation: 1,
            time: time ? [first + time[0], first + time[1]] : null,
            hour,
            fill,
            stations: picked,
          };
          const result = state.apply(request);
          const expected = bruteForce(observations, stations, request);
          expect(Array.from(result.hour)).toEqual(expected.hour);
          expect(Array.from(result.fill)).toEqual(expected.fill);
          expect(Array.from(result.stations)).toEqual(expected.stations);
          expect(result.passing).toBe(expected.stations.reduce((sum, n) => sum + n, 0));
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe('filter requests in the worker', () => {
  const handle = createHandler({
    decode: () => Promise.reject(new Error('no decoder')),
    fetch: () => Promise.reject(new Error('no network')),
  });
  const filters = (generation: number): FilterRequest => ({
    generation,
    time: null,
    hour: [7, 10],
    fill: null,
    stations: null,
  });

  test('a raw dataset gets a generation, and filters for it come back as counts', async () => {
    const { response } = await handle({
      id: 1,
      type: 'generate',
      options: { seed: 1, rows: 20_000 },
    });
    if (response.type !== 'dataset' || response.generation === null)
      throw new Error('expected a filterable dataset');
    const { response: filtered, transfer } = await handle({
      id: 2,
      type: 'filter',
      filters: filters(response.generation),
    });
    if (filtered.type !== 'filtered') throw new Error(`expected counts, got ${filtered.type}`);
    expect(filtered.result.hour).toHaveLength(HOUR_BINS);
    expect(filtered.result.passing).toBeGreaterThan(0);
    expect(transfer).toHaveLength(3);
  });

  test('filters for an older dataset are refused, not answered with the new one', async () => {
    const first = await handle({ id: 1, type: 'generate', options: { seed: 1, rows: 1_000 } });
    await handle({ id: 2, type: 'generate', options: { seed: 2, rows: 1_000 } });
    if (first.response.type !== 'dataset' || first.response.generation === null)
      throw new Error('expected a filterable dataset');
    const { response } = await handle({
      id: 3,
      type: 'filter',
      filters: filters(first.response.generation),
    });
    expect(response).toMatchObject({
      type: 'error',
      message: expect.stringMatching(/^Filters for dataset/) as string,
    });
  });
});

describe('the client keeps one filter update in flight', () => {
  test('while one runs, only the latest brush position is sent next, and every caller gets an answer', async () => {
    const sent: WorkerRequest[] = [];
    let listener: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
    const worker: WorkerLike = {
      postMessage: (message) => sent.push(message),
      addEventListener: (type: string, fn: unknown) => {
        if (type === 'message') listener = fn as typeof listener;
      },
      terminate: () => undefined,
    };
    const client = createDataClient(worker);
    const reply = (request: WorkerRequest | undefined, passing: number) => {
      if (request?.type !== 'filter') throw new Error('expected a filter request');
      const result = {
        generation: 1,
        hour: new Uint32Array(HOUR_BINS),
        fill: new Uint32Array(FILL_BINS),
        stations: new Uint32Array(0),
        passing,
        rows: 10,
      };
      listener?.({
        data: { id: request.id, type: 'filtered', result },
      } as MessageEvent<WorkerResponse>);
    };
    const at = (lo: number): FilterRequest => ({
      generation: 1,
      time: null,
      hour: [lo, lo + 2],
      fill: null,
      stations: null,
    });

    const a = client.filter(at(1));
    const b = client.filter(at(2));
    const c = client.filter(at(3));
    // Only the first went out; b was replaced by c before it could be sent.
    expect(sent).toHaveLength(1);
    reply(sent[0], 5);
    expect((await a).passing).toBe(5);
    await Promise.resolve();
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ filters: { hour: [3, 5] } });
    reply(sent[1], 9);
    expect((await b).passing).toBe(9);
    expect((await c).passing).toBe(9);
  });
});
