import { allocateObservations, type ObservationColumns, type StationTable } from '@bicing/core';
import type { DuckDBConnection } from '@duckdb/node-api';
import { asNumber, scalar, withDuckDB } from './duckdb';
import { stageTables, type MonthInput, type MonthReport } from './month';

/** One month's staged tables read into the app's columnar schema (T2.2). */
export interface MonthData {
  readonly observations: ObservationColumns;
  readonly stations: StationTable;
  readonly report: MonthReport;
}

export async function readMonth(input: MonthInput): Promise<MonthData> {
  return withDuckDB(async (connection) => {
    const report = await stageTables(connection, input);
    const stations = await readStations(connection);
    const observations = await readObservations(connection);
    return { observations, stations, report };
  });
}

export async function readStations(connection: DuckDBConnection): Promise<StationTable> {
  const reader = await connection.runAndReadAll(
    `SELECT station_id, name, lat, lon, capacity FROM stations ORDER BY idx`,
  );
  const rows = reader.getRows();
  const ids: string[] = [];
  const names: string[] = [];
  const lat = new Float32Array(rows.length);
  const lon = new Float32Array(rows.length);
  const capacity = new Uint8Array(rows.length);
  rows.forEach(([id, name, la, lo, cap], i) => {
    const stationId = String(id);
    ids.push(stationId);
    // No usable information row: keep the readings, mark the station (ADR 0012).
    names.push(typeof name === 'string' ? name : `#${stationId}`);
    lat[i] = la === null || la === undefined ? Number.NaN : asNumber(la);
    lon[i] = lo === null || lo === undefined ? Number.NaN : asNumber(lo);
    capacity[i] = cap === null || cap === undefined ? 0 : asNumber(cap);
  });
  return { length: rows.length, ids, names, lat, lon, capacity };
}

/** Streams the sorted rows chunk by chunk into preallocated columns, never as row objects (P4). */
export async function readObservations(connection: DuckDBConnection): Promise<ObservationColumns> {
  const length = await scalar(connection, `SELECT count(*) FROM obs`);
  const columns = allocateObservations(length);
  const result = await connection.stream(`
    SELECT s.idx, o.t, o.bikes_mech, o.bikes_elec, o.docks, o.status
    FROM obs AS o JOIN stations AS s USING (station_id)
    ORDER BY o.t, s.idx`);
  const targets = [
    columns.stationIdx,
    columns.t,
    columns.bikesMech,
    columns.bikesElec,
    columns.docks,
    columns.status,
  ] as const;
  let offset = 0;
  for (let chunk = await result.fetchChunk(); chunk; chunk = await result.fetchChunk()) {
    if (chunk.rowCount === 0) break;
    targets.forEach((target, column) => {
      chunk.visitColumnValues(column, (value, row) => {
        target[offset + row] = asNumber(value);
      });
    });
    offset += chunk.rowCount;
  }
  if (offset !== length)
    throw new Error(`expected ${String(length)} rows, streamed ${String(offset)}`);
  return columns;
}
