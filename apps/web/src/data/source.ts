import type { Level } from '@bicing/data';

/** One level of the whole history over a window (T2.5b). */
export interface HistoryRequest {
  readonly level: Level;
  readonly t0: number;
  readonly t1: number;
}

/**
 * Where a dataset comes from: the seeded generator, a month of Open Data BCN (ADR 0013), or the
 * whole history at the level the view needs (ADR 0014).
 */
export type DataSource =
  | { readonly kind: 'synthetic'; readonly rows: number }
  | { readonly kind: 'real'; readonly month: string }
  | ({ readonly kind: 'history' } & HistoryRequest);

/** The month picker's value for the whole history. */
export const WHOLE_HISTORY = 'history';

/** Absolute, so the worker resolves file names the same way the page does. */
export const DATA_BASE_URL = new URL(
  import.meta.env.VITE_DATA_BASE_URL ?? '/data/',
  location.href,
).toString();

export function sourceKey(source: DataSource): string {
  switch (source.kind) {
    case 'synthetic':
      return `synthetic:${String(source.rows)}`;
    case 'real':
      return `real:${source.month}`;
    case 'history':
      return `history:${source.level}:${String(source.t0)}-${String(source.t1)}`;
  }
}
