import type { GeneratedDataset } from '@bicing/data';
import { describe, expect, test } from 'vitest';
import { effectScope, nextTick, shallowRef } from 'vue';
import { PLAY_MS } from './playback';
import type { Dataset } from './useDataset';
import { useMapMoment, type FrameClock } from './useMapMoment';

/** Only the series' extent matters to the moment. */
const loaded = (xMin: number, xMax: number) =>
  ({ series: { x: Uint32Array.of(xMin, xMax), xMin, xMax } }) as unknown as GeneratedDataset;

/** Frames run when the test says so, at the time it says. */
function manualClock() {
  const pending = new Map<number, (now: number) => void>();
  let next = 1;
  const clock: FrameClock = {
    request: (cb) => {
      pending.set(next, cb);
      return next++;
    },
    cancel: (h) => pending.delete(h),
  };
  const frame = (now: number) => {
    const callbacks = [...pending.values()];
    pending.clear();
    for (const cb of callbacks) cb(now);
  };
  return { clock, frame, pending };
}

function setup() {
  const current = shallowRef<GeneratedDataset | null>(loaded(0, 3_000));
  const dataset = { current } as unknown as Dataset;
  const { clock, frame, pending } = manualClock();
  const scope = effectScope();
  const map = scope.run(() => useMapMoment(dataset, clock));
  if (!map) throw new Error('no map moment');
  return { current, map, frame, pending, scope };
}

describe('useMapMoment', () => {
  test('crosshair first, then the scrubber, then the end of the view', () => {
    const { map } = setup();
    expect(map.moment.value).toBe(3_000);
    map.onChartView([0, 2_000]);
    expect(map.moment.value).toBe(2_000);
    map.scrub(500);
    expect(map.moment.value).toBe(500);
    expect(map.pinned.value).toBe(true);
    map.onChartHover({ t: 900 } as never);
    expect(map.moment.value).toBe(900);
    map.onChartHover(null);
    map.follow();
    expect(map.moment.value).toBe(2_000);
  });

  test('play walks to the end by wall time, then stops', () => {
    const { map, frame, pending } = setup();
    map.scrub(0);
    map.play();
    frame(1_000);
    frame(1_000 + PLAY_MS / 3);
    expect(map.moment.value).toBeCloseTo(1_000, 6);
    // One very slow frame skips ahead instead of slowing playback.
    frame(1_000 + PLAY_MS);
    expect(map.moment.value).toBe(3_000);
    expect(map.playing.value).toBe(false);
    expect(pending.size).toBe(0);
  });

  test('play from the end starts over; scrubbing pauses', () => {
    const { map, frame } = setup();
    map.play();
    expect(map.moment.value).toBe(0);
    frame(0);
    map.scrub(1_234);
    expect(map.playing.value).toBe(false);
    frame(PLAY_MS);
    expect(map.moment.value).toBe(1_234);
  });

  test('a new dataset stops playback and unpins', async () => {
    const { current, map, pending } = setup();
    map.scrub(100);
    map.play();
    current.value = loaded(5_000, 6_000);
    await nextTick();
    expect(map.playing.value).toBe(false);
    expect(map.pinned.value).toBe(false);
    expect(pending.size).toBe(0);
    expect(map.moment.value).toBe(6_000);
  });

  test('disposing the scope cancels the next frame', () => {
    const { map, pending, scope } = setup();
    map.play();
    scope.stop();
    expect(pending.size).toBe(0);
  });
});
