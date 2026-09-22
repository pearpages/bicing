import { generate } from '@bicing/synthetic';
import { transferList, type WorkerRequest, type WorkerResponse } from './protocol';

export interface HandledResponse {
  readonly response: WorkerResponse;
  readonly transfer: ArrayBuffer[];
}

/**
 * The worker's logic without the worker: a pure function from a request to a response plus its
 * transfer list, so it can be unit-tested in Node.
 */
export function handleRequest(request: WorkerRequest): HandledResponse {
  // One request type today ('generate'). Phase 2 adds Parquet loading, and this becomes a switch.
  try {
    const started = performance.now();
    const { observations, stations } = generate(request.options);
    const elapsedMs = performance.now() - started;
    return {
      response: { id: request.id, type: 'generated', observations, stations, elapsedMs },
      transfer: transferList(observations, stations),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { response: { id: request.id, type: 'error', message }, transfer: [] };
  }
}
