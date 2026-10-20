/**
 * Downloads the Open Data BCN Bicing history into an idempotent cache: one 7z archive per dataset
 * and month, found through CKAN (no hardcoded archive URLs). A second run downloads nothing.
 *
 *   pnpm prepare-data [--out data/raw] [--from 2024-01] [--to 2024-12] [--dry-run]
 *   pnpm prepare-data --read-month 2026-09   (reads a cached month into columns and reports it)
 *   pnpm prepare-data --build [--from …] [--to …]   (downloads, stages and publishes data/parquet)
 */
import { join, resolve } from 'node:path';
import { toEpochMs } from '@bicing/core';
import { parseArgs } from 'node:util';
import { DATASETS, discover, inRange, isAllowedUrl, type MonthlyResource } from './ckan';
import { readManifest, syncResources } from './download';
import { prepareMonth } from './prepare';
import { publish } from './publish';
import { stageMonth } from './stage';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function parseMonth(name: string, raw: string): string | null {
  if (raw === '') return null;
  if (!MONTH.test(raw)) throw new Error(`--${name} must be YYYY-MM, got "${raw}"`);
  return raw;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      out: { type: 'string', default: 'data/raw' },
      from: { type: 'string', default: '' },
      to: { type: 'string', default: '' },
      concurrency: { type: 'string', default: '3' },
      'dry-run': { type: 'boolean', default: false },
      'read-month': { type: 'string', default: '' },
      build: { type: 'boolean', default: false },
    },
  });
  // pnpm runs the script from tools/prepare-data; resolve --out against where the user typed the command.
  const out = resolve(process.env.INIT_CWD ?? process.cwd(), values.out);
  const from = parseMonth('from', values.from);
  const to = parseMonth('to', values.to);
  const readMonth = parseMonth('read-month', values['read-month']);
  if (readMonth !== null) {
    await summarizeMonth(out, readMonth);
    return;
  }
  const concurrency = Number(values.concurrency);
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 8)
    throw new Error(`--concurrency must be 1–8, got "${values.concurrency}"`);

  const resources: MonthlyResource[] = [];
  for (const dataset of DATASETS) {
    const found = inRange(await discover(dataset), from, to);
    console.log(
      `${dataset}: ${String(found.length)} monthly archive${found.length === 1 ? '' : 's'}`,
    );
    resources.push(...found);
  }
  const megabytes = resources.reduce((sum, r) => sum + (r.size ?? 0), 0) / 1e6;
  if (values['dry-run']) {
    for (const r of resources) console.log(`  ${r.dataset}/${r.month}  ${r.name}`);
    console.log(`${String(resources.length)} archives, ~${megabytes.toFixed(0)} MB (dry run)`);
    return;
  }

  const started = performance.now();
  const report = await syncResources(resources, {
    dir: out,
    concurrency,
    allowUrl: (url) => isAllowedUrl(url),
    log: (line) => {
      console.log(`  ${line}`);
    },
  });
  const seconds = (performance.now() - started) / 1_000;
  console.log(
    `${String(report.downloaded.length)} downloaded, ${String(report.skipped.length)} already cached, ` +
      `${String(report.failed.length)} failed → ${out} (${seconds.toFixed(1)} s)`,
  );
  if (report.failed.length > 0) {
    process.exitCode = 1;
    return;
  }
  if (values.build) await build(out, resources);
}

/** Stages every month both datasets have, then publishes them (architecture.md > Ingest). */
async function build(rawDir: string, resources: readonly MonthlyResource[]): Promise<void> {
  const data = resolve(rawDir, '..');
  const byDataset = (dataset: string) =>
    new Set(resources.filter((r) => r.dataset === dataset).map((r) => r.month));
  const status = byDataset('estat-estacions-bicing');
  const info = byDataset('informacio-estacions-bicing');
  const months = [...status].filter((m) => info.has(m)).sort();
  const cache = (await readManifest(rawDir)).files;

  const staged: string[] = [];
  const unusable: { month: string; reason: string }[] = [];
  const failed: string[] = [];
  for (const month of months) {
    const statusEntry = cache[`estat-estacions-bicing/${month}.7z`];
    const infoEntry = cache[`informacio-estacions-bicing/${month}.7z`];
    if (!statusEntry || !infoEntry) throw new Error(`${month}: archives are not in the cache`);
    const started = performance.now();
    try {
      const { report, cached } = await stageMonth({
        rawDir,
        stageDir: join(data, 'stage'),
        scratchDir: join(data, 'scratch'),
        month,
        sources: { status: statusEntry, info: infoEntry },
      });
      if (report.unusable !== undefined) {
        unusable.push({ month, reason: report.unusable });
        console.log(`  unusable ${month}: ${report.unusable}`);
        continue;
      }
      staged.push(month);
      console.log(
        `  ${cached ? 'cached' : 'staged'} ${month}: ${String(report.observations)} readings` +
          (cached ? '' : ` (${((performance.now() - started) / 1_000).toFixed(1)} s)`) +
          (report.informationProblem ? `; ${report.informationProblem}, dropped` : ''),
      );
    } catch (error) {
      failed.push(month);
      console.error(`  failed ${month}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  // A month that failed its checks would look like a gap in gaps.json; better to publish nothing.
  if (failed.length > 0) {
    console.error(`${String(failed.length)} months failed to stage; nothing published.`);
    process.exitCode = 1;
    return;
  }
  const summary = await publish({
    stageDir: join(data, 'stage'),
    outDir: join(data, 'parquet'),
    staged,
    catalogue: months,
    unusable,
    log: (line) => {
      console.log(`  ${line}`);
    },
  });
  const merged = summary.files.at(-1);
  console.log(
    `${String(summary.stations)} stations, ${String(merged?.rows ?? 0)} readings in ` +
      `${String(summary.files.length - 1)} monthly files + observations.parquet ` +
      `(${((merged?.bytes ?? 0) / 1e6).toFixed(0)} MB); ${String(summary.gaps.gaps.length)} gaps, ` +
      `missing months: ${summary.gaps.missingMonths.join(', ') || 'none'} → ${join(data, 'parquet')}`,
  );
}

/** T2.2's check by hand: one cached month through extraction and DuckDB, summarized. */
async function summarizeMonth(rawDir: string, month: string): Promise<void> {
  const started = performance.now();
  // The ~1.3 GB of CSVs are extracted next to the cache and removed afterwards.
  const {
    observations,
    stations,
    report: summary,
  } = await prepareMonth(rawDir, month, join(rawDir, '..', 'scratch'));
  const at = (i: number) => new Date(toEpochMs(observations.t[i] ?? 0)).toISOString();
  console.log(summary);
  console.log(
    `${String(observations.length)} readings from ${String(stations.length)} stations, ` +
      `${at(0)} → ${at(observations.length - 1)} (${((performance.now() - started) / 1_000).toFixed(1)} s)`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
