/**
 * `manifest.json` (T2.3) lists the published months. The app reads it to offer them; the worker
 * builds file names from them, so a month must look like `YYYY-MM` before it goes in a URL.
 */

export interface MonthEntry {
  readonly month: string;
  readonly rows: number;
  readonly bytes: number;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isMonth(value: unknown): value is string {
  return typeof value === 'string' && MONTH.test(value);
}

export function monthFile(month: string): string {
  if (!isMonth(month)) throw new Error(`not a month: ${JSON.stringify(month)}`);
  return `observations-${month}.parquet`;
}

export type Level = 'raw' | '1h' | '1d';

/** Bucket sizes of ADR 0014's aggregate levels, in minutes: also each level's gap threshold. */
export const BUCKET_MINUTES = { '1h': 60, '1d': 1_440 } as const;

/** One published file, as `manifest.json` describes it (T2.3, T2.5a). */
export interface CatalogFile {
  readonly file: string;
  readonly level: Level;
  readonly month: string | null;
  readonly rows: number;
  readonly bytes: number;
  /** First and last `t` in the file, minutes since the epoch; `null` when it's empty. */
  readonly t0: number | null;
  readonly t1: number | null;
}

/**
 * The names T2.3 and T2.5a write. A file name goes into a URL, so anything else in the manifest
 * is rejected rather than fetched (security.md).
 */
function expectedName(level: unknown, month: unknown, file: unknown): boolean {
  if (typeof file !== 'string') return false;
  if (level === 'raw')
    return month === null
      ? file === 'observations.parquet'
      : isMonth(month) && file === monthFile(month);
  if (month !== null) return false;
  if (level === '1d') return file === 'agg-1d.parquet';
  return level === '1h' && /^agg-1h-\d{4}\.parquet$/.test(file);
}

const isTime = (v: unknown): v is number | null =>
  v === null || (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0);

/** Every file in `manifest.json`, checked. Throws on anything unexpected. */
export function parseCatalog(body: unknown): CatalogFile[] {
  const files: unknown =
    typeof body === 'object' && body !== null ? (body as { files?: unknown }).files : undefined;
  if (!Array.isArray(files)) throw new Error('manifest.json has no file list');
  return files.map((entry): CatalogFile => {
    const { file, level, month, rows, bytes, t0, t1 } =
      typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {};
    // Manifests from before T2.5a have no level: their files are all raw.
    const fileLevel = level ?? 'raw';
    if (
      !expectedName(fileLevel, month, file) ||
      typeof rows !== 'number' ||
      typeof bytes !== 'number' ||
      !isTime(t0) ||
      !isTime(t1)
    )
      throw new Error('manifest.json has an invalid entry');
    return {
      file: file as string,
      level: fileLevel as Level,
      month: month as string | null,
      rows,
      bytes,
      t0,
      t1,
    };
  });
}

/** The monthly raw files, oldest first. */
export function parseManifest(body: unknown): MonthEntry[] {
  return parseCatalog(body)
    .filter((f): f is CatalogFile & { month: string } => f.level === 'raw' && f.month !== null)
    .map(({ month, rows, bytes }) => ({ month, rows, bytes }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/** For the main thread: a small JSON file, fetched once to fill the month picker. */
export async function fetchManifest(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MonthEntry[]> {
  const response = await fetchImpl(new URL('manifest.json', baseUrl));
  if (!response.ok) throw new Error(`manifest.json answered HTTP ${String(response.status)}`);
  return parseManifest(await response.json());
}
