import { allocateObservations } from '@bicing/core';
import { describe, expect, test } from 'vitest';
import { createDataClient, type WorkerLike } from './client';
import type { WorkerRequest, WorkerResponse } from './protocol';

/** A fake worker that records requests and lets the test answer them in any order. */
function fakeWorker() {
  const requests: WorkerRequest[] = [];
  const listeners: {
    message: ((event: MessageEvent<WorkerResponse>) => void)[];
    error: ((event: ErrorEvent) => void)[];
  } = { message: [], error: [] };
  let terminated = false;
  const worker = {
    postMessage: (message: WorkerRequest) => requests.push(message),
    addEventListener: (type: 'message' | 'error', listener: never) => {
      listeners[type].push(listener);
    },
    terminate: () => {
      terminated = true;
    },
  } as WorkerLike;
  const reply = (response: WorkerResponse) => {
    for (const l of listeners.message) l({ data: response } as MessageEvent<WorkerResponse>);
  };
  const fail = (message: string) => {
    for (const l of listeners.error) l({ message } as ErrorEvent);
  };
  return { worker, requests, reply, fail, isTerminated: () => terminated };
}

const stations = {
  length: 0,
  ids: [],
  names: [],
  lat: new Float32Array(0),
  lon: new Float32Array(0),
  capacity: new Uint8Array(0),
};

const series = {
  x: new Uint32Array(0),
  y: new Uint8Array(0),
  offsets: Uint32Array.of(0),
  meanFill: new Float32Array(0),
  lineStarts: Uint32Array.of(0),
  lineStation: new Uint16Array(0),
  maxGap: 15,
  xMin: 0,
  xMax: 0,
  yMax: 0,
};

function generated(id: number, rows: number): WorkerResponse {
  return {
    id,
    type: 'generated',
    observations: allocateObservations(rows),
    stations,
    series,
    elapsedMs: 1,
  };
}

describe('createDataClient', () => {
  test('matches responses to requests by id, even out of order', async () => {
    const { worker, requests, reply } = fakeWorker();
    const client = createDataClient(worker);
    const a = client.generate({ seed: 1, rows: 10 });
    const b = client.generate({ seed: 1, rows: 20 });
    const [ra, rb] = requests;
    if (!ra || !rb) throw new Error('expected two requests');
    expect(ra.id).not.toBe(rb.id);

    reply(generated(rb.id, 20));
    reply(generated(ra.id, 10));
    expect((await a).observations.length).toBe(10);
    expect((await b).observations.length).toBe(20);
  });

  test('error responses reject only their own request', async () => {
    const { worker, requests, reply } = fakeWorker();
    const client = createDataClient(worker);
    const a = client.generate({ seed: 1, rows: 10 });
    const b = client.generate({ seed: 1, rows: 10 });
    reply({ id: requests[0]?.id ?? -1, type: 'error', message: 'boom' });
    reply(generated(requests[1]?.id ?? -1, 10));
    await expect(a).rejects.toThrow('boom');
    await expect(b).resolves.toMatchObject({ workerMs: 1 });
  });

  test('ignores responses for unknown ids', async () => {
    const { worker, requests, reply } = fakeWorker();
    const client = createDataClient(worker);
    const a = client.generate({ seed: 1, rows: 5 });
    reply(generated(999, 1));
    reply(generated(requests[0]?.id ?? -1, 5));
    expect((await a).observations.length).toBe(5);
  });

  test('a worker crash rejects everything pending', async () => {
    const { worker, fail } = fakeWorker();
    const client = createDataClient(worker);
    const a = client.generate({ seed: 1, rows: 5 });
    fail('out of memory');
    await expect(a).rejects.toThrow('out of memory');
  });

  test('dispose rejects pending requests and terminates the worker', async () => {
    const { worker, isTerminated } = fakeWorker();
    const client = createDataClient(worker);
    const a = client.generate({ seed: 1, rows: 5 });
    client.dispose();
    await expect(a).rejects.toThrow('disposed');
    expect(isTerminated()).toBe(true);
  });
});
