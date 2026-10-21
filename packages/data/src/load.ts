import type { ObservationColumns, StationTable } from '@bicing/core';
import {
  concatMonths,
  RAW_SPEC,
  readColumns,
  validateColumns,
  type DecodeParquet,
} from './columns';
import { monthFile } from './manifest';
import { parseStations } from './stations';

export interface LoadOptions {
  /** Absolute, ending in `/`: where `stations.json` and the monthly files live (ADR 0013). */
  readonly baseUrl: string;
  /** `YYYY-MM`, oldest first. */
  readonly months: readonly string[];
}

export interface LoadDeps {
  readonly decode: DecodeParquet;
  readonly fetch: typeof fetch;
}

export async function fetchOk(deps: LoadDeps, url: URL): Promise<Response> {
  const response = await deps.fetch(url);
  if (!response.ok) throw new Error(`${url.pathname} answered HTTP ${String(response.status)}`);
  return response;
}

/** Fetches, decodes and checks the months, then joins them into one store. Runs in the worker (P8). */
export async function loadMonths(
  options: LoadOptions,
  deps: LoadDeps,
): Promise<{ observations: ObservationColumns; stations: StationTable }> {
  if (options.months.length === 0) throw new Error('no months to load');
  const stations = parseStations(
    await (await fetchOk(deps, new URL('stations.json', options.baseUrl))).json(),
  );
  // Fetched in parallel, decoded and checked one by one, so only one file is ever decoded at once.
  const files = options.months.map(async (month) => {
    const response = await fetchOk(deps, new URL(monthFile(month), options.baseUrl));
    return new Uint8Array(await response.arrayBuffer());
  });
  // If an earlier month fails, the later fetches still settle; mark them handled, not unhandled.
  for (const file of files) file.catch(() => undefined);
  const parts = [];
  for (const [i, file] of files.entries()) {
    const month = options.months[i] ?? '';
    const columns = readColumns(await deps.decode(await file), RAW_SPEC, month);
    validateColumns(columns, stations.length, month);
    parts.push(columns);
  }
  return { observations: concatMonths(parts), stations };
}
