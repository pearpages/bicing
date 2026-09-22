export interface SizeTier {
  readonly rows: number;
  readonly label: string;
  /** Opt-in tiers at the edge of browser memory (see the plan: about 500 MB of columns at 50M). */
  readonly stress?: boolean;
}

export const SIZE_TIERS: readonly SizeTier[] = [
  { rows: 10_000, label: '10k' },
  { rows: 100_000, label: '100k' },
  { rows: 1_000_000, label: '1M' },
  { rows: 10_000_000, label: '10M' },
  { rows: 50_000_000, label: '50M', stress: true },
];

export const DEFAULT_ROWS = 1_000_000;
export const SEED = 42;
