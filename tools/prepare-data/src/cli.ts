/**
 * Downloads the Open Data BCN Bicing history into an idempotent cache: one 7z archive per dataset
 * and month, found through CKAN (no hardcoded archive URLs). A second run downloads nothing.
 *
 *   pnpm prepare-data [--out data/raw] [--from 2024-01] [--to 2024-12] [--dry-run]
 */
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { DATASETS, discover, inRange, isAllowedUrl } from './ckan';
import { syncResources } from './download';

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
    },
  });
  // pnpm runs the script from tools/prepare-data; resolve --out against where the user typed the command.
  const out = resolve(process.env.INIT_CWD ?? process.cwd(), values.out);
  const from = parseMonth('from', values.from);
  const to = parseMonth('to', values.to);
  const concurrency = Number(values.concurrency);
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 8)
    throw new Error(`--concurrency must be 1–8, got "${values.concurrency}"`);

  const resources = [];
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
  if (report.failed.length > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
