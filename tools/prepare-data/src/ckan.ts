/**
 * Resource discovery through CKAN's `package_show`, so no archive URL is hardcoded (tasks.md T2.1).
 * The response is untrusted input (security.md): only fields we check are used, and only monthly
 * archives on the Open Data BCN host over HTTPS survive.
 */

export const OPEN_DATA_BCN = 'https://opendata-ajuntament.barcelona.cat';

/** The two datasets the explorer needs: station status history and station information. */
export const DATASETS = ['estat-estacions-bicing', 'informacio-estacions-bicing'] as const;
export type DatasetId = (typeof DATASETS)[number];

export interface MonthlyResource {
  readonly dataset: DatasetId;
  /** CKAN's resource id: stable across re-uploads, so it keys the cache. */
  readonly id: string;
  readonly name: string;
  readonly url: string;
  /** `YYYY-MM`, parsed from the name. Also the file name on disk, so it can't escape the cache. */
  readonly month: string;
  readonly size: number | null;
  /** Changes when the city re-uploads an archive; a change means "download again". */
  readonly lastModified: string | null;
}

// e.g. 2026_01_Gener_BicingNou_ESTACIONS.7z: the month name is Catalan and isn't needed.
const ARCHIVE_NAME = /^(\d{4})_(\d{2})_[\p{L}]+_BicingNou_(?:ESTACIONS|INFORMACIO)\.7z$/u;

/** Only HTTPS on the Open Data BCN host: the URLs come from a response, not from us. */
export function isAllowedUrl(raw: string, base = OPEN_DATA_BCN): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && url.origin === new URL(base).origin;
  } catch {
    return false;
  }
}

export function packageShowUrl(dataset: DatasetId, base = OPEN_DATA_BCN): string {
  const url = new URL('/data/api/3/action/package_show', base);
  url.searchParams.set('id', dataset);
  return url.toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** CKAN sends sizes as numbers or numeric strings, or not at all. */
function optionalSize(value: unknown): number | null {
  const size = typeof value === 'string' ? Number(value) : value;
  return typeof size === 'number' && Number.isSafeInteger(size) && size > 0 ? size : null;
}

/** Parses a `package_show` body into the monthly archives, sorted by month. Throws on a malformed body. */
export function monthlyResources(
  dataset: DatasetId,
  body: unknown,
  base = OPEN_DATA_BCN,
): MonthlyResource[] {
  if (!isRecord(body) || body.success !== true || !isRecord(body.result))
    throw new Error(`${dataset}: package_show did not succeed`);
  const { resources } = body.result;
  if (!Array.isArray(resources)) throw new Error(`${dataset}: package_show has no resources`);

  const found = new Map<string, MonthlyResource>();
  for (const resource of resources) {
    if (!isRecord(resource)) continue;
    const { id, name, url } = resource;
    if (typeof id !== 'string' || typeof name !== 'string' || typeof url !== 'string') continue;
    // The live "securitzat" feeds need a token and aren't history.
    if (resource.token_required === 'Yes') continue;
    const match = ARCHIVE_NAME.exec(name);
    if (!match || !isAllowedUrl(url, base)) continue;
    const [, year, mm] = match;
    const monthNumber = Number(mm);
    if (monthNumber < 1 || monthNumber > 12) continue;
    const month = `${String(year)}-${String(mm)}`;
    // Two resources for one month would write the same file; keep the first and say so.
    if (found.has(month)) {
      console.warn(
        `${dataset}: more than one archive for ${month}, keeping ${found.get(month)?.name ?? ''}`,
      );
      continue;
    }
    found.set(month, {
      dataset,
      id,
      name,
      url,
      month,
      size: optionalSize(resource.size),
      lastModified: optionalString(resource.last_modified),
    });
  }
  return [...found.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/** Keeps the months in `[from, to]` (inclusive, `YYYY-MM`); either end may be open. */
export function inRange(
  resources: readonly MonthlyResource[],
  from: string | null,
  to: string | null,
): MonthlyResource[] {
  return resources.filter(
    (r) => (from === null || r.month >= from) && (to === null || r.month <= to),
  );
}

export async function discover(
  dataset: DatasetId,
  base = OPEN_DATA_BCN,
): Promise<MonthlyResource[]> {
  const response = await fetch(packageShowUrl(dataset, base), {
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(`${dataset}: package_show answered HTTP ${String(response.status)}`);
  return monthlyResources(dataset, await response.json(), base);
}
