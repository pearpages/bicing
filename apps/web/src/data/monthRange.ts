import { toMinutes } from '@bicing/core';

/** A UTC month, `YYYY-MM`, as [start, start of next month) in minutes since the epoch. */
export function monthRange(month: string): readonly [number, number] {
  const [year, index] = month.split('-').map(Number) as [number, number];
  return [toMinutes(Date.UTC(year, index - 1, 1)), toMinutes(Date.UTC(year, index, 1))];
}
