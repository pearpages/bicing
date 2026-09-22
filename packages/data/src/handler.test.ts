import { describe, expect, test } from 'vitest';
import { handleRequest } from './handler';

describe('handleRequest', () => {
  test('generate answers with the dataset and lists every buffer for transfer', () => {
    const { response, transfer } = handleRequest({
      id: 7,
      type: 'generate',
      options: { seed: 1, rows: 1_000 },
    });
    if (response.type !== 'generated') throw new Error('expected a generated response');
    expect(response.id).toBe(7);
    expect(response.observations.length).toBe(1_000);
    // 6 observation columns + lat, lon, capacity.
    expect(transfer).toHaveLength(9);
  });

  test('transferring detaches the sender copies (zero-copy move, not a clone)', () => {
    const { response, transfer } = handleRequest({
      id: 1,
      type: 'generate',
      options: { seed: 2, rows: 5_000 },
    });
    if (response.type !== 'generated') throw new Error('expected a generated response');
    const before = Array.from(response.observations.bikesMech.subarray(0, 10));

    // structuredClone with a transfer list has the same semantics as postMessage.
    const received = structuredClone(response, { transfer });

    expect(response.observations.t.byteLength).toBe(0);
    expect(response.observations.bikesMech.byteLength).toBe(0);
    expect(response.stations.lat.byteLength).toBe(0);
    expect(received.observations.t).toHaveLength(5_000);
    expect(Array.from(received.observations.bikesMech.subarray(0, 10))).toEqual(before);
  });

  test('failures become error responses with the same id', () => {
    const { response, transfer } = handleRequest({
      id: 3,
      type: 'generate',
      options: { seed: 1, rows: -1 },
    });
    expect(response).toMatchObject({ id: 3, type: 'error' });
    expect(transfer).toHaveLength(0);
  });
});
