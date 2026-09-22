/**
 * Writes a synthetic dataset to disk: one raw little-endian file per column, plus stations.json
 * and manifest.json. Phase 2 switches the output to Parquet; the generator stays the same.
 *
 *   pnpm synth --seed 42 --rows 1e6 --out data/synthetic [--gap-days 3,4]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { toEpochMs, type ObservationColumnName } from '@bicing/core';
import { generate } from '@bicing/synthetic';

const COLUMNS: readonly ObservationColumnName[] = [
  'stationIdx',
  't',
  'bikesMech',
  'bikesElec',
  'docks',
  'status',
];

function parsePositiveInt(name: string, raw: string): number {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`--${name} must be a non-negative integer, got "${raw}"`);
  return value;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      seed: { type: 'string', default: '42' },
      rows: { type: 'string', default: '1e6' },
      out: { type: 'string', default: 'data/synthetic' },
      'gap-days': { type: 'string', default: '' },
    },
  });
  // pnpm runs the script from tools/synthetic; resolve --out against where the user typed the command.
  const out = resolve(process.env.INIT_CWD ?? process.cwd(), values.out);
  const seed = parsePositiveInt('seed', values.seed);
  const rows = parsePositiveInt('rows', values.rows);
  const gapDays =
    values['gap-days'] === ''
      ? []
      : values['gap-days'].split(',').map((d) => parsePositiveInt('gap-days', d));

  const started = performance.now();
  const { stations, observations } = generate({ seed, rows, gapDays });
  const generatedMs = performance.now() - started;

  await mkdir(out, { recursive: true });
  const files = await Promise.all(
    COLUMNS.map(async (name) => {
      const column = observations[name];
      const file = `${name}.bin`;
      await writeFile(
        join(out, file),
        new Uint8Array(column.buffer, column.byteOffset, column.byteLength),
      );
      return { name, type: column.constructor.name, file, bytes: column.byteLength };
    }),
  );

  const first = observations.t[0];
  const last = observations.t[observations.length - 1];
  const manifest = {
    format: 'bicing-pulse/raw-columns@1',
    endianness: 'little',
    seed,
    rows,
    gapDays,
    stations: stations.length,
    timeRange:
      first === undefined || last === undefined
        ? null
        : {
            from: new Date(toEpochMs(first)).toISOString(),
            to: new Date(toEpochMs(last)).toISOString(),
          },
    columns: files,
  };
  const stationsJson = {
    ids: stations.ids,
    names: stations.names,
    lat: Array.from(stations.lat),
    lon: Array.from(stations.lon),
    capacity: Array.from(stations.capacity),
  };
  await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await writeFile(join(out, 'stations.json'), JSON.stringify(stationsJson));

  const megabytes = files.reduce((sum, f) => sum + f.bytes, 0) / 1e6;
  console.log(
    `${rows.toLocaleString('en')} rows × ${String(stations.length)} stations → ${out} ` +
      `(${megabytes.toFixed(1)} MB, generated in ${generatedMs.toFixed(0)} ms)`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
