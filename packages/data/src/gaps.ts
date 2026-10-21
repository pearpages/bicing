import { isMonth } from './manifest';

/** `gaps.json` (T2.3), checked: it's fetched, so untrusted like the rest (security.md). */
export interface GapCatalog {
  readonly gaps: readonly { readonly t0: number; readonly t1: number }[];
  readonly missingMonths: readonly string[];
  readonly unusableMonths: readonly { readonly month: string; readonly reason: string }[];
}

const isMinute = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

export function parseGaps(body: unknown): GapCatalog {
  const fail = () => new Error('gaps.json has unexpected fields');
  if (typeof body !== 'object' || body === null) throw fail();
  const { gaps, missingMonths, unusableMonths } = body as Record<string, unknown>;
  if (!Array.isArray(gaps) || !Array.isArray(missingMonths)) throw fail();
  return {
    gaps: gaps.map((gap: unknown) => {
      const { t0, t1 } = (typeof gap === 'object' && gap !== null ? gap : {}) as Record<
        string,
        unknown
      >;
      if (!isMinute(t0) || !isMinute(t1) || t1 < t0) throw fail();
      return { t0, t1 };
    }),
    missingMonths: missingMonths.map((month: unknown) => {
      if (!isMonth(month)) throw fail();
      return month;
    }),
    // Older builds (before ADR 0012's broken-archive handling) have no unusable months.
    unusableMonths: (Array.isArray(unusableMonths) ? unusableMonths : []).map((entry: unknown) => {
      const { month, reason } = (
        typeof entry === 'object' && entry !== null ? entry : {}
      ) as Record<string, unknown>;
      if (!isMonth(month) || typeof reason !== 'string') throw fail();
      return { month, reason };
    }),
  };
}

export async function fetchGaps(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GapCatalog> {
  const response = await fetchImpl(new URL('gaps.json', baseUrl));
  if (!response.ok) throw new Error(`gaps.json answered HTTP ${String(response.status)}`);
  return parseGaps(await response.json());
}
