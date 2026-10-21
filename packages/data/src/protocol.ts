import type { ObservationColumns, StationSeries, StationTable } from '@bicing/core';
import type { GenerateOptions } from '@bicing/synthetic';
import type { LoadOptions } from './load';
import type { Level } from './manifest';
import type { ViewOptions } from './view';

/** What a whole-history view holds (T2.5b): its level, the coverage and the loaded window. */
export interface ViewInfo {
  readonly level: Level;
  /** The whole coverage, [first, last + 1): the chart's zoom extent at every level. */
  readonly extent: readonly [number, number];
  /** The [t0, t1) that was loaded. */
  readonly window: readonly [number, number];
}

/**
 * Main thread ↔ worker messages. A discriminated union rather than Comlink (ADR 0005): the
 * protocol is small, and making every transfer list explicit is the point of the exercise.
 */
export type WorkerRequest =
  | { readonly id: number; readonly type: 'generate'; readonly options: GenerateOptions }
  /** Real data: Parquet months from a base URL (ADR 0013). */
  | { readonly id: number; readonly type: 'load'; readonly options: LoadOptions }
  /** One level of the whole history over a window (T2.5b, ADR 0014). */
  | { readonly id: number; readonly type: 'view'; readonly options: ViewOptions };

export type WorkerResponse =
  | {
      readonly id: number;
      readonly type: 'dataset';
      /** `null` for an aggregate view: the main thread only needs the series. */
      readonly observations: ObservationColumns | null;
      readonly stations: StationTable;
      readonly series: StationSeries;
      /** Readings, or buckets for an aggregate view. */
      readonly rows: number;
      readonly view: ViewInfo | null;
      /** Time spent generating or loading inside the worker, excluding the postMessage hop. */
      readonly elapsedMs: number;
    }
  | { readonly id: number; readonly type: 'error'; readonly message: string };

/**
 * Every ArrayBuffer in a dataset. Passing them as the transfer list *moves* them to the other
 * thread in O(1) instead of structured-cloning hundreds of MB. The sender's views become detached
 * (byteLength 0), which the tests assert.
 */
export function transferList(
  observations: ObservationColumns | null,
  stations: StationTable,
  series: StationSeries,
): ArrayBuffer[] {
  const views = [
    ...(observations
      ? [
          observations.stationIdx,
          observations.t,
          observations.bikesMech,
          observations.bikesElec,
          observations.docks,
          observations.status,
        ]
      : []),
    stations.lat,
    stations.lon,
    stations.capacity,
    series.x,
    series.y,
    series.offsets,
    series.meanFill,
    series.lineStarts,
    series.lineStation,
  ];
  // Distinct buffers only: transferring the same buffer twice throws a DataCloneError.
  return [...new Set(views.map((view) => view.buffer as ArrayBuffer))];
}
