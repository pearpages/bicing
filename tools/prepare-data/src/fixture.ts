import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import SevenZip from '7z-wasm';

/**
 * Test-only builders for a tiny month in the real formats (not exported from index.ts). The CSVs
 * are written in a column order unlike any real year, to prove columns are read by name.
 */

/** Seconds since the Unix epoch for a September 2026 minute. */
export const sep = (day: number, hour: number, minute: number) =>
  Date.UTC(2026, 8, day, hour, minute) / 1_000;

export function statusCsv(rows: readonly (readonly (string | number)[])[]): string {
  const header = [
    'last_updated',
    'status',
    'num_docks_available',
    'station_id',
    'num_bikes_available_types.ebike',
    'is_installed',
    'num_bikes_available_types.mechanical',
    'last_reported',
  ];
  return [header, ...rows]
    .map((r) => r.map((v) => (typeof v === 'string' ? `"${v}"` : String(v))).join(','))
    .join('\n');
}

export function infoCsv(rows: readonly (readonly (string | number)[])[]): string {
  const header = ['capacity', 'station_id', 'lon', 'name', 'lat', 'altitude', 'last_updated'];
  return [header, ...rows]
    .map((r) => r.map((v) => (typeof v === 'string' ? `"${v}"` : String(v))).join(','))
    .join('\n');
}

/**
 * Status rows: [last_updated, status, docks, station, ebikes, installed, mech, last_reported].
 * Station 2 repeats one report in two snapshots, station 3 is stale (a report from July), station 9
 * has no information row, and one row has "NA" docks.
 */
export const STATUS_ROWS: readonly (readonly (string | number)[])[] = [
  [sep(1, 10, 5), 'IN_SERVICE', 10, 1, 2, 1, 8, sep(1, 10, 4)],
  [sep(1, 10, 5), 'IN_SERVICE', 5, 2, 0, 1, 15, sep(1, 10, 3)],
  [sep(1, 10, 5), 'MAINTENANCE', 0, 3, 0, 1, 0, Date.UTC(2026, 6, 1) / 1_000],
  [sep(1, 10, 5), 'PLANNED', 0, 9, 0, 1, 0, sep(1, 10, 1)],
  [sep(1, 10, 10), 'IN_SERVICE', 9, 1, 3, 1, 8, sep(1, 10, 9)],
  // Same report from station 2, seen again: one row survives, from this later snapshot.
  [sep(1, 10, 10), 'IN_SERVICE', 5, 2, 0, 1, 15, sep(1, 10, 3)],
  [sep(1, 10, 10), 'NOT_IN_SERVICE', 'NA', 1, 0, 1, 0, sep(1, 10, 8)],
  [sep(1, 10, 10), 'NOT_IN_SERVICE', 20, 2, 0, 1, 0, sep(1, 10, 9)],
];

/** Info rows: [capacity, station, lon, name, lat, altitude, last_updated]. */
export const INFO_ROWS: readonly (readonly (string | number)[])[] = [
  [20, 1, 2.18, 'OLD NAME', 41.39, 16, sep(1, 10, 0)],
  [20, 1, 2.18, ' GRAN VIA, 760', 41.39, 16, sep(1, 10, 5)],
  // A shifted row, like station 1 in 2019-03: the capacity field holds something else.
  [1, 2, 2.17, 'ROGER DE FLOR, 126', 41.395, 17, sep(1, 10, 5)],
  [30, 3, 2.19, 'NÀPOLS, 82', 41.394, 11, sep(1, 10, 5)],
];

/** Writes `archive.7z` in `dir` holding `files` (name → content), using the same 7-Zip as production. */
export async function createArchive(
  dir: string,
  archive: string,
  files: Readonly<Record<string, string>>,
): Promise<string> {
  await mkdir(dir, { recursive: true });
  const staging = join(dir, `${archive}.staging`);
  await mkdir(staging, { recursive: true });
  for (const [name, content] of Object.entries(files))
    await writeFile(join(staging, name), content);
  const module = await SevenZip({ print: () => undefined, printErr: () => undefined });
  module.FS.mkdir('/work');
  module.FS.mount(module.NODEFS, { root: dir }, '/work');
  module.FS.chdir(`/work/${archive}.staging`);
  module.callMain(['a', '-bso0', '-bsp0', `/work/${archive}`, ...Object.keys(files)]);
  return join(dir, archive);
}
