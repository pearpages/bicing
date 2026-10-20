import { EPOCH_MS, Status } from '@bicing/core';
import type { DuckDBConnection } from '@duckdb/node-api';
import { scalar, sqlString } from './duckdb';

/**
 * One month of Open Data BCN CSVs → staged DuckDB tables (ADR 0012). The set work happens in SQL;
 * `columns.ts` reads the result into typed arrays and `publish.ts` writes it as Parquet.
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

/**
 * Builds the month's tables on `connection`: `obs` (station_id, t, bikes, docks, status), `stations`
 * (station_id, idx, name, lat, lon, capacity) and `snapshots` (t of every feed snapshot, for gap
 * detection). Throws when the month fails its quality checks.
 */
export async function stageTables(
  connection: DuckDBConnection,
  input: MonthInput,
): Promise<MonthReport> {
  const maxShare = input.maxInvalidShare ?? 0.01;
  const { start, end } = monthBounds(input.month);
  const label = (kind: string) => `${input.month} ${kind}`;
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
  // When the feed itself published, whatever each station reported: a gap here is the whole system.
  await connection.run(`
    CREATE TEMP TABLE snapshots AS
    SELECT DISTINCT ((updated - ${String(EPOCH_SECONDS)}) // 60)::UINTEGER AS t
    FROM status_valid
    WHERE updated BETWEEN ${String(start - DAY_SECONDS)} AND ${String(end + DAY_SECONDS)}
    ORDER BY t`);

  const statusRows = await scalar(connection, `SELECT count(*) FROM status_typed`);
  const validStatus = await scalar(connection, `SELECT count(*) FROM status_valid`);
  const currentStatus = await scalar(connection, `SELECT count(*) FROM status_current`);
  const infoRows = await scalar(connection, `SELECT count(*) FROM ${info}`);
  const validInfo = await scalar(connection, `SELECT count(*) FROM info_valid`);
  const invalid = 'rows are invalid';
  failIfOver(label('status'), invalid, statusRows - validStatus, statusRows, maxShare);
  failIfOver(label('information'), invalid, infoRows - validInfo, infoRows, maxShare);
  const withoutInfo = await scalar(connection, `SELECT count(*) FROM stations WHERE name IS NULL`);
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

  const observations = await scalar(connection, `SELECT count(*) FROM obs`);
  return {
    month: input.month,
    statusRows,
    invalidStatusRows: statusRows - validStatus,
    staleReports: validStatus - currentStatus,
    repeatedReports: currentStatus - observations,
    infoRows,
    invalidInfoRows: infoRows - validInfo,
    stations: await scalar(connection, `SELECT count(*) FROM stations`),
    stationsWithoutInfo: withoutInfo,
    capacityFromReadings: repaired,
    observations,
  };
}
