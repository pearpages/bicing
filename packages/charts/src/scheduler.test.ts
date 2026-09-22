import { describe, expect, test } from 'vitest';
import { FrameScheduler, type FrameClock } from './scheduler';

type Layer = 'data' | 'axes' | 'overlay';

function manualClock() {
  let next = 1;
  const callbacks = new Map<number, (time: number) => void>();
  const clock: FrameClock = {
    request: (callback) => {
      callbacks.set(next, callback);
      return next++;
    },
    cancel: (handle) => {
      callbacks.delete(handle);
    },
  };
  const frame = (time = 16) => {
    const pending = [...callbacks.values()];
    callbacks.clear();
    for (const callback of pending) callback(time);
  };
  return { clock, frame, pendingFrames: () => callbacks.size };
}

function setup() {
  const { clock, frame, pendingFrames } = manualClock();
  const draws: Layer[][] = [];
  const scheduler = new FrameScheduler<Layer>((dirty) => {
    draws.push([...dirty].sort());
  }, clock);
  return { scheduler, frame, pendingFrames, draws };
}

describe('FrameScheduler', () => {
  test('many invalidations in one frame produce a single draw with the union of layers', () => {
    const { scheduler, frame, pendingFrames, draws } = setup();
    scheduler.invalidate('data');
    scheduler.invalidate('axes');
    scheduler.invalidate('data');
    expect(pendingFrames()).toBe(1);
    frame();
    expect(draws).toEqual([['axes', 'data']]);
  });

  test('nothing is drawn when nothing is dirty', () => {
    const { scheduler, frame, draws } = setup();
    scheduler.invalidate();
    frame();
    expect(draws).toEqual([]);
  });

  test('invalidating during a draw schedules the next frame instead of being lost', () => {
    const { clock, frame } = manualClock();
    const draws: string[][] = [];
    const scheduler: FrameScheduler<Layer> = new FrameScheduler<Layer>((dirty) => {
      draws.push([...dirty]);
      if (draws.length === 1) scheduler.invalidate('overlay');
    }, clock);
    scheduler.invalidate('data');
    frame();
    frame();
    expect(draws).toEqual([['data'], ['overlay']]);
  });

  test('a throwing draw does not wedge the scheduler', () => {
    const { clock, frame } = manualClock();
    let calls = 0;
    const scheduler = new FrameScheduler<Layer>(() => {
      calls++;
      if (calls === 1) throw new Error('boom');
    }, clock);
    scheduler.invalidate('data');
    expect(() => {
      frame();
    }).toThrow('boom');
    scheduler.invalidate('data');
    frame();
    expect(calls).toBe(2);
  });

  test('flush draws synchronously and cancels the pending frame', () => {
    const { scheduler, frame, pendingFrames, draws } = setup();
    scheduler.invalidate('axes');
    scheduler.flush();
    expect(draws).toEqual([['axes']]);
    expect(pendingFrames()).toBe(0);
    frame();
    expect(draws).toHaveLength(1);
  });

  test('destroy cancels pending work and ignores later invalidations', () => {
    const { scheduler, frame, pendingFrames, draws } = setup();
    scheduler.invalidate('data');
    scheduler.destroy();
    scheduler.invalidate('axes');
    frame();
    expect(pendingFrames()).toBe(0);
    expect(draws).toEqual([]);
  });
});
