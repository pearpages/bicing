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

/** The monthly files, oldest first. The merged file (`month: null`) is left out. */
export function parseManifest(body: unknown): MonthEntry[] {
  const files: unknown =
    typeof body === 'object' && body !== null ? (body as { files?: unknown }).files : undefined;
  if (!Array.isArray(files)) throw new Error('manifest.json has no file list');
  const months: MonthEntry[] = [];
  for (const file of files) {
    if (typeof file !== 'object' || file === null) continue;
    const { month, rows, bytes } = file as Record<string, unknown>;
    if (month === null) continue;
    if (!isMonth(month) || typeof rows !== 'number' || typeof bytes !== 'number')
      throw new Error('manifest.json has an invalid entry');
    months.push({ month, rows, bytes });
  }
  return months.sort((a, b) => a.month.localeCompare(b.month));
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
