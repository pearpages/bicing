/** Where a dataset comes from: the seeded generator, or a month of Open Data BCN (ADR 0013). */
export type DataSource =
  | { readonly kind: 'synthetic'; readonly rows: number }
  | { readonly kind: 'real'; readonly month: string };

/** Absolute, so the worker resolves file names the same way the page does. */
export const DATA_BASE_URL = new URL(
  import.meta.env.VITE_DATA_BASE_URL ?? '/data/',
  location.href,
).toString();

export const sourceKey = (source: DataSource): string =>
  source.kind === 'synthetic' ? `synthetic:${String(source.rows)}` : `real:${source.month}`;
