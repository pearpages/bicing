import { describe, expect, test } from 'vitest';
import { createHandler } from './handler';

const handleRequest = createHandler({
  decode: () => Promise.reject(new Error('no decoder in this test')),
  fetch: () => Promise.reject(new Error('no network in this test')),
});

describe('handleRequest', () => {
  test('generate answers with the dataset and lists every buffer for transfer', async () => {
    const { response, transfer } = await handleRequest({
      id: 7,
      type: 'generate',
      options: { seed: 1, rows: 1_000 },
    });
    if (response.type !== 'dataset') throw new Error('expected a dataset response');
    expect(response.id).toBe(7);
    expect(response.observations.length).toBe(1_000);
    // 6 observation columns + lat, lon, capacity + 6 series arrays.
    expect(transfer).toHaveLength(15);
    expect(response.series.offsets).toHaveLength(response.stations.length + 1);
  });

  test('transferring detaches the sender copies (zero-copy move, not a clone)', async () => {
    const { response, transfer } = await handleRequest({
      id: 1,
      type: 'generate',
      options: { seed: 2, rows: 5_000 },
    });
    if (response.type !== 'dataset') throw new Error('expected a dataset response');
    const before = Array.from(response.observations.bikesMech.subarray(0, 10));

    // structuredClone with a transfer list has the same semantics as postMessage.
    const received = structuredClone(response, { transfer });

    expect(response.observations.t.byteLength).toBe(0);
    expect(response.observations.bikesMech.byteLength).toBe(0);
    expect(response.stations.lat.byteLength).toBe(0);
    expect(response.series.x.byteLength).toBe(0);
    expect(received.observations.t).toHaveLength(5_000);
    expect(Array.from(received.observations.bikesMech.subarray(0, 10))).toEqual(before);
  });

  test('failures become error responses with the same id', async () => {
    const { response, transfer } = await handleRequest({
      id: 3,
      type: 'generate',
      options: { seed: 1, rows: -1 },
    });
    expect(response).toMatchObject({ id: 3, type: 'error' });
    expect(transfer).toHaveLength(0);
  });

  test('a load that fails to fetch is an error response, not a crash', async () => {
    const { response } = await handleRequest({
      id: 4,
      type: 'load',
      options: { baseUrl: 'https://data.example/', months: ['2026-09'] },
    });
    expect(response).toEqual({ id: 4, type: 'error', message: 'no network in this test' });
  });
});
