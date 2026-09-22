import type { ObservationColumns, StationTable } from '@bicing/core';
import type { GenerateOptions } from '@bicing/synthetic';

/**
 * Main thread ↔ worker messages. A discriminated union rather than Comlink (ADR 0005): the
 * protocol is small, and making every transfer list explicit is the point of the exercise.
 */
export interface WorkerRequest {
  readonly id: number;
  readonly type: 'generate';
  readonly options: GenerateOptions;
}

export type WorkerResponse =
  | {
      readonly id: number;
      readonly type: 'generated';
      readonly observations: ObservationColumns;
      readonly stations: StationTable;
      /** Time spent generating inside the worker, excluding the postMessage hop. */
      readonly elapsedMs: number;
    }
  | { readonly id: number; readonly type: 'error'; readonly message: string };

/**
 * Every ArrayBuffer in a dataset. Passing them as the transfer list *moves* them to the other
 * thread in O(1) instead of structured-cloning hundreds of MB. The sender's views become detached
 * (byteLength 0), which the tests assert.
 */
export function transferList(
  observations: ObservationColumns,
  stations: StationTable,
): ArrayBuffer[] {
  const views = [
    observations.stationIdx,
    observations.t,
    observations.bikesMech,
    observations.bikesElec,
    observations.docks,
    observations.status,
    stations.lat,
    stations.lon,
    stations.capacity,
  ];
  // Distinct buffers only: transferring the same buffer twice throws a DataCloneError.
  return [...new Set(views.map((view) => view.buffer as ArrayBuffer))];
}
