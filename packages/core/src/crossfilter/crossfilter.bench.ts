import { describe, expect, test } from 'vitest';
import { Crossfilter } from './crossfilter';

/**
 * T3.1's done-when (ADR 0015): a brush move over 10M rows updates in under 16 ms. Run with
 * `pnpm bench -- --run`; it's kept out of the normal test run, where timing would be flaky on
 * shared CI machines. Each result is written to `packages/core/bench-results/` (git-ignored: the
 * numbers belong to the machine; the README records them with it, P5). Rows are shaped like a month of readings: 560 stations, an hour that
 * follows time, and occupancy bins from a seeded generator (P19).
 */
const ROWS = 10_000_000;
const STATIONS = 560;
const HOURS = 24;
const FILL_BINS = 20;
const FRAME_MS = 16;

let seed = 1;
const random = () => (seed = (seed * 1_664_525 + 1_013_904_223) >>> 0) / 2 ** 32;
const station = new Uint16Array(ROWS);
const hour = new Uint8Array(ROWS);
const fill = new Uint8Array(ROWS);
for (let i = 0; i < ROWS; i++) {
  station[i] = i % STATIONS;
  hour[i] = Math.floor((i / ROWS) * HOURS * 30) % HOURS;
  fill[i] = Math.floor(random() * FILL_BINS);
}
const cf = new Crossfilter({
  dimensions: [
    { bins: hour, binCount: HOURS },
    { bins: fill, binCount: FILL_BINS },
  ],
  group: { bins: station, binCount: STATIONS },
});

/** 0, 1, …, max, max - 1, …: a brush dragged back and forth one step at a time, never jumping. */
function pingPong(max: number): () => number {
  let at = 0;
  let direction = 1;
  return () => {
    if (at + direction < 0 || at + direction > max) direction = -direction;
    at += direction;
    return at;
  };
}

describe('Crossfilter, 10M rows: one brush move per iteration', () => {
  test('occupancy brush drag: one bin enters, one leaves', async ({ bench }) => {
    const step = pingPong(FILL_BINS - 5);
    const result = await bench(
      'occupancy drag',
      { writeResult: 'bench-results/crossfilter-occupancy-drag.json' },
      () => {
        const lo = step();
        cf.filterRange(1, lo, lo + 5);
      },
    ).run();
    expect(result.latency.p99).toBeLessThan(FRAME_MS);
  });

  test('hour brush drag: one hour enters, one leaves', async ({ bench }) => {
    const step = pingPong(HOURS - 3);
    const result = await bench(
      'hour drag',
      { writeResult: 'bench-results/crossfilter-hour-drag.json' },
      () => {
        const lo = step();
        cf.filterRange(0, lo, lo + 3);
      },
    ).run();
    expect(result.latency.p99).toBeLessThan(FRAME_MS);
  });

  test('time brush drag: a half-width range moved by 0.5%', async ({ bench }) => {
    const step = pingPong(100);
    const result = await bench(
      'time drag',
      { writeResult: 'bench-results/crossfilter-time-drag.json' },
      () => {
        const start = Math.floor((step() * ROWS) / 200);
        cf.filterRows(start, start + ROWS / 2);
      },
    ).run();
    expect(result.latency.p99).toBeLessThan(FRAME_MS);
  });

  // Not a drag: the worst case, recorded for the README rather than held to a frame.
  test('occupancy brush jump across the whole axis', async ({ bench }) => {
    let wide = false;
    const result = await bench(
      'occupancy jump',
      { writeResult: 'bench-results/crossfilter-occupancy-jump.json' },
      () => {
        wide = !wide;
        if (wide) cf.filterRange(1, 0, FILL_BINS);
        else cf.filterRange(1, 9, 10);
      },
    ).run();
    expect(result.latency.mean).toBeGreaterThan(0);
  });
});
