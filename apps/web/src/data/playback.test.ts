import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { PLAY_MS, playStep } from './playback';

describe('playStep', () => {
  test('the whole range plays in PLAY_MS, whatever its span', () => {
    expect(playStep(0, PLAY_MS / 2, [0, 43_200])).toEqual({ t: 21_600, done: false });
    expect(playStep(1_000, PLAY_MS / 4, [1_000, 2_000])).toEqual({ t: 1_250, done: false });
  });

  test('it stops at the end, never past it, and never runs backwards', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000 }),
        fc.integer({ min: 1, max: 100_000 }),
        fc.double({ min: -100, max: 100_000, noNaN: true }),
        (t0, span, elapsed) => {
          const extent = [t0, t0 + span] as const;
          const start = t0 + span / 3;
          const step = playStep(start, elapsed, extent);
          expect(step.t).toBeGreaterThanOrEqual(start);
          expect(step.t).toBeLessThanOrEqual(extent[1]);
          expect(step.done).toBe(step.t === extent[1]);
        },
      ),
    );
  });
});
