import {
  allocateObservations,
  EPOCH_MS,
  Status,
  type ObservationColumns,
  type StationTable,
} from '@bicing/core';
import { DuckDBInstance, type DuckDBConnection, type DuckDBValue } from '@duckdb/node-api';

/**
 * One month of Open Data BCN CSVs → the app's columnar schema (ADR 0012). DuckDB does the set work
 * in SQL; TypeScript only streams the sorted result into typed arrays (P4).
 */

export interface MonthReport {
  readonly month: string;
  readonly statusRows: number;
  /** Rows dropped because a field failed its cast: a sign of header drift, so it's capped. */
  readonly invalidStatusRows: number;
  /**
   * Rows whose `last_reported` falls outside the month (±1 day): a silent station, often in
   * maintenance, repeating an old report in every snapshot. Dropped, never shown as fresh (P9).
   */
  readonly staleReports: number;
  /** Rows that repeated a (station, minute) already kept: the same report seen in several snapshots. */
  readonly repeatedReports: number;
  readonly infoRows: number;
  readonly invalidInfoRows: number;
  readonly stations: number;
  /** Stations with readings but no usable information row this month. */
  readonly stationsWithoutInfo: number;
  /**
   * Stations whose information row has a capacity below half the bikes and docks they reported
   * (a shifted row, e.g. station 1 in 2019-03). Their capacity comes from the readings instead.
   */
  readonly capacityFromReadings: number;
  readonly observations: number;
}

export interface MonthData {
  readonly observations: ObservationColumns;
  readonly stations: StationTable;
  readonly report: MonthReport;
}

export interface MonthInput {
  /** `YYYY-MM`: readings outside it (with a day of margin) are invalid. */
  readonly month: string;
  readonly statusCsv: string;
  readonly infoCsv: string;
  /** Share of invalid rows above which the month fails instead of being quietly thinned. */
  readonly maxInvalidShare?: number;
  /**
   * Casts can't see a shifted row: station 1's 2019-03 rows put another field in `capacity`. A
   * station's capacity can't be far below the bikes plus free docks it reported, so one station
   * like that is repaired from its readings. Above this share of stations, the header is off.
   */
  readonly maxRepairedShare?: number;
}

/** Columns read by header name. Their order and the other columns drift between years. */
const STATUS_COLUMNS = [
  'station_id',
  'num_bikes_available_types.mechanical',
  'num_bikes_available_types.ebike',
  'num_docks_available',
  'status',
  'last_reported',
  'last_updated',
] as const;
const INFO_COLUMNS = ['station_id', 'name', 'lat', 'lon', 'capacity', 'last_updated'] as const;

const EPOCH_SECONDS = EPOCH_MS / 1_000;
const DAY_SECONDS = 86_400;

/** Barcelona with room to spare; anything outside is a shifted or broken row. */
const BOUNDS = { latMin: 41.2, latMax: 41.6, lonMin: 1.9, lonMax: 2.4 };

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function csv(path: string): string {
  return `read_csv(${sqlString(path)}, header = true, delim = ',', quote = '"', all_varchar = true)`;
}

function monthBounds(month: string): { start: number; end: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw new Error(`month must be YYYY-MM, got "${month}"`);
  const year = Number(match[1]);
  const index = Number(match[2]) - 1;
  return { start: Date.UTC(year, index, 1) / 1_000, end: Date.UTC(year, index + 1, 1) / 1_000 };
}

async function scalar(connection: DuckDBConnection, sql: string): Promise<number> {
  const reader = await connection.runAndReadAll(sql);
  const value = reader.getRows()[0]?.[0];
  return Number(value ?? 0);
}

async function requireColumns(
  connection: DuckDBConnection,
  source: string,
  required: readonly string[],
  label: string,
): Promise<void> {
  const reader = await connection.runAndReadAll(`DESCRIBE SELECT * FROM ${source}`);
  const present = new Set(reader.getRows().map((row) => String(row[0])));
  const missing = required.filter((column) => !present.has(column));
  if (missing.length > 0) throw new Error(`${label}: missing columns ${missing.join(', ')}`);
}

function failIfOver(
  label: string,
  what: string,
  count: number,
  total: number,
  maxShare: number,
): void {
  if (total > 0 && count / total > maxShare)
    throw new Error(
      `${label}: ${String(count)} of ${String(total)} ${what} ` +
        `(over ${String(maxShare * 100)}%): the columns may not match the header`,
    );
}

function asNumber(value: DuckDBValue): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  throw new Error(`expected a number from DuckDB, got ${String(value)}`);
}

export async function readMonth(input: MonthInput): Promise<MonthData> {
  const maxShare = input.maxInvalidShare ?? 0.01;
  const { start, end } = monthBounds(input.month);
  const label = (kind: string) => `${input.month} ${kind}`;
  const instance = await DuckDBInstance.create(':memory:');
  const connection = await instance.connect();
  try {
    const status = csv(input.statusCsv);
    const info = csv(input.infoCsv);
    await requireColumns(connection, status, STATUS_COLUMNS, label('status'));
    await requireColumns(connection, info, INFO_COLUMNS, label('information'));

    // Every field is cast with TRY_CAST, so a bad value becomes NULL and the row fails `valid`.
    await connection.run(`
      CREATE TEMP TABLE status_typed AS
      SELECT
        TRY_CAST(station_id AS UINTEGER) AS station_id,
        TRY_CAST("num_bikes_available_types.mechanical" AS UTINYINT) AS bikes_mech,
        TRY_CAST("num_bikes_available_types.ebike" AS UTINYINT) AS bikes_elec,
        TRY_CAST(num_docks_available AS UTINYINT) AS docks,
        CASE status
          WHEN 'IN_SERVICE' THEN ${String(Status.InService)}
          WHEN 'NOT_IN_SERVICE' THEN ${String(Status.Closed)}
          WHEN 'MAINTENANCE' THEN ${String(Status.Closed)}
          ELSE ${String(Status.Other)}
        END::UTINYINT AS status,
        TRY_CAST(last_reported AS BIGINT) AS reported,
        TRY_CAST(last_updated AS BIGINT) AS updated
      FROM ${status}`);
    await connection.run(`
      CREATE TEMP TABLE status_valid AS
      SELECT * FROM status_typed
      WHERE station_id IS NOT NULL AND bikes_mech IS NOT NULL AND bikes_elec IS NOT NULL
        AND docks IS NOT NULL AND updated IS NOT NULL AND reported IS NOT NULL`);
    await connection.run(`
      CREATE TEMP TABLE status_current AS
      SELECT * FROM status_valid
      WHERE reported BETWEEN ${String(start - DAY_SECONDS)} AND ${String(end + DAY_SECONDS)}`);

    // last_reported is the time (ADR 0012): a report repeated across snapshots is kept once, from
    // the latest snapshot, and a silent station leaves a gap.
    await connection.run(`
      CREATE TEMP TABLE obs AS
      SELECT station_id, ((reported - ${String(EPOCH_SECONDS)}) // 60)::UINTEGER AS t,
             bikes_mech, bikes_elec, docks, status
      FROM status_current
      QUALIFY row_number() OVER (
        PARTITION BY station_id, (reported - ${String(EPOCH_SECONDS)}) // 60 ORDER BY updated DESC
      ) = 1`);

    // The month's latest usable information row per station.
    await connection.run(`
      CREATE TEMP TABLE info_valid AS
      SELECT
        TRY_CAST(station_id AS UINTEGER) AS station_id,
        trim(name) AS name,
        TRY_CAST(lat AS DOUBLE) AS lat,
        TRY_CAST(lon AS DOUBLE) AS lon,
        TRY_CAST(capacity AS UTINYINT) AS capacity,
        TRY_CAST(last_updated AS BIGINT) AS updated
      FROM ${info}
      WHERE TRY_CAST(station_id AS UINTEGER) IS NOT NULL AND trim(name) <> ''
        AND TRY_CAST(lat AS DOUBLE) BETWEEN ${String(BOUNDS.latMin)} AND ${String(BOUNDS.latMax)}
        AND TRY_CAST(lon AS DOUBLE) BETWEEN ${String(BOUNDS.lonMin)} AND ${String(BOUNDS.lonMax)}
        AND TRY_CAST(capacity AS UTINYINT) IS NOT NULL
        AND TRY_CAST(last_updated AS BIGINT) IS NOT NULL`);
    // `slots` is the most bikes + free docks a station reported: GBFS capacity can't be far below it.
    await connection.run(`
      CREATE TEMP TABLE stations AS
      SELECT ids.station_id, (row_number() OVER (ORDER BY ids.station_id) - 1)::USMALLINT AS idx,
             latest.name, latest.lat, latest.lon,
             latest.capacity IS NOT NULL AND latest.capacity < 0.5 * ids.slots AS repaired,
             CASE WHEN latest.capacity < 0.5 * ids.slots THEN least(ids.slots, 255)
                  ELSE latest.capacity END::UTINYINT AS capacity
      FROM (
        SELECT station_id, max(bikes_mech::INTEGER + bikes_elec + docks) AS slots FROM obs GROUP BY 1
      ) AS ids
      LEFT JOIN (
        SELECT * FROM info_valid
        QUALIFY row_number() OVER (PARTITION BY station_id ORDER BY updated DESC) = 1
      ) AS latest USING (station_id)
      ORDER BY ids.station_id`);

    const statusRows = await scalar(connection, `SELECT count(*) FROM status_typed`);
    const validStatus = await scalar(connection, `SELECT count(*) FROM status_valid`);
    const currentStatus = await scalar(connection, `SELECT count(*) FROM status_current`);
    const infoRows = await scalar(connection, `SELECT count(*) FROM ${info}`);
    const validInfo = await scalar(connection, `SELECT count(*) FROM info_valid`);
    const invalid = 'rows are invalid';
    failIfOver(label('status'), invalid, statusRows - validStatus, statusRows, maxShare);
    failIfOver(label('information'), invalid, infoRows - validInfo, infoRows, maxShare);
    const withoutInfo = await scalar(
      connection,
      `SELECT count(*) FROM stations WHERE name IS NULL`,
    );
    const repaired = await scalar(
      connection,
      `SELECT count(*) FILTER (WHERE repaired) FROM stations`,
    );
    failIfOver(
      label('information'),
      'stations have a capacity below half the bikes and docks they reported',
      repaired,
      await scalar(connection, `SELECT count(*) FROM stations`),
      input.maxRepairedShare ?? 0.1,
    );

    const stations = await readStations(connection);
    const observations = await readObservations(connection);
    return {
      observations,
      stations,
      report: {
        month: input.month,
        statusRows,
        invalidStatusRows: statusRows - validStatus,
        staleReports: validStatus - currentStatus,
        repeatedReports: currentStatus - observations.length,
        infoRows,
        invalidInfoRows: infoRows - validInfo,
        stations: stations.length,
        stationsWithoutInfo: withoutInfo,
        capacityFromReadings: repaired,
        observations: observations.length,
      },
    };
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}

async function readStations(connection: DuckDBConnection): Promise<StationTable> {
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
async function readObservations(connection: DuckDBConnection): Promise<ObservationColumns> {
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
