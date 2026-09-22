import { describe, expect, test } from 'vitest';
import { linesOf, VIEW } from '../testing';
import { CanvasRenderer } from './CanvasRenderer';

/** Records the 2D calls the renderer makes; enough to test culling and batching without a real canvas. */
function recordingCanvas() {
  const calls: { op: string; args: unknown[] }[] = [];
  const record =
    (op: string) =>
    (...args: unknown[]) => {
      calls.push({ op, args });
    };
  const ctx = {
    setTransform: record('setTransform'),
    clearRect: record('clearRect'),
    beginPath: record('beginPath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    stroke: record('stroke'),
    lineWidth: 1,
    globalAlpha: 1,
    lineJoin: 'miter',
    strokeStyle: '',
  };
  const classes = new Set<string>();
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
    remove: () => undefined,
    classList: { add: (c: string) => classes.add(c) },
  } as unknown as HTMLCanvasElement;
  return { canvas, calls, count: (op: string) => calls.filter((c) => c.op === op).length };
}

describe('CanvasRenderer', () => {
  test('sizes the backing store by dpr and draws in CSS pixels', () => {
    const { canvas, calls } = recordingCanvas();
    const r = new CanvasRenderer({ canvas });
    r.resize(200, 100, 2);
    r.setData(
      linesOf([
        [
          [0, 0],
          [100, 10],
        ],
      ]),
    );
    r.render(VIEW);
    expect([canvas.width, canvas.height]).toEqual([400, 200]);
    expect(calls.find((c) => c.op === 'setTransform')?.args).toEqual([2, 0, 0, 2, 0, 0]);
    expect(calls.find((c) => c.op === 'moveTo')?.args).toEqual([0, 100]);
    expect(calls.find((c) => c.op === 'lineTo')?.args).toEqual([200, 0]);
  });

  test('one stroke per color bucket, not per line', () => {
    const { canvas, count } = recordingCanvas();
    const r = new CanvasRenderer({ canvas });
    const line: [number, number][] = [
      [0, 1],
      [50, 2],
      [100, 3],
    ];
    r.setData(linesOf([line, line, line, line], [0, 0, 1, 1]));
    const stats = r.render(VIEW);
    expect(count('stroke')).toBe(2);
    expect(stats).toEqual({ points: 12, drawCalls: 2 });
  });

  test('culls points outside the x-domain (keeping one neighbor per side)', () => {
    const { canvas } = recordingCanvas();
    const r = new CanvasRenderer({ canvas });
    const long = Array.from({ length: 1_000 }, (_, i): [number, number] => [i, 1]);
    r.setData(linesOf([long]));
    const stats = r.render({ ...VIEW, xDomain: [100, 110] });
    expect(stats.points).toBe(13);
  });

  test('an isolated sample is still drawn (1 px dash)', () => {
    const { canvas, count } = recordingCanvas();
    const r = new CanvasRenderer({ canvas });
    r.setData(linesOf([[[50, 5]]]));
    r.render(VIEW);
    expect(count('lineTo')).toBe(1);
  });

  test('rejects more points than maxPoints', () => {
    const { canvas } = recordingCanvas();
    const r = new CanvasRenderer({ canvas });
    const huge = { ...linesOf([]), x: { length: r.maxPoints + 1 } as Uint32Array };
    expect(() => {
      r.setData(huge);
    }).toThrow(RangeError);
  });
});
