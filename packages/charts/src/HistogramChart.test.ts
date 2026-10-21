// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest';
import { HistogramChart, histogramBars, type BarCanvas } from './HistogramChart';
import type { FrameClock } from './scheduler';

describe('histogramBars', () => {
  test('bars scale to the largest total; passing never exceeds its total', () => {
    const bars = histogramBars([10, 20, 0, 5], [5, 20, 0, 9], 400, 100);
    expect(bars.map((b) => b.total)).toEqual([50, 100, 0, 25]);
    expect(bars.map((b) => b.passing)).toEqual([25, 100, 0, 25]);
    // Four bands across 400 px, padded but in order and the same width.
    expect(bars.map((b) => Math.round(b.x))).toEqual(
      [...bars.map((b) => Math.round(b.x))].sort((a, b) => a - b),
    );
    expect(new Set(bars.map((b) => b.width.toFixed(6))).size).toBe(1);
  });

  test('no data: flat bars, no division by zero', () => {
    const bars = histogramBars([0, 0], [0, 0], 100, 50);
    expect(bars.map((b) => [b.total, b.passing])).toEqual([
      [0, 0],
      [0, 0],
    ]);
  });
});

function manualClock() {
  const pending = new Map<number, (t: number) => void>();
  let next = 1;
  const clock: FrameClock = {
    request: (cb) => {
      pending.set(next, cb);
      return next++;
    },
    cancel: (h) => pending.delete(h),
  };
  const frame = () => {
    const callbacks = [...pending.values()];
    pending.clear();
    for (const cb of callbacks) cb(16);
  };
  return { clock, frame };
}

/** jsdom has no canvas: record what would be drawn. */
function fakeCanvas() {
  const rects: { fill: string; x: number; y: number; w: number; h: number }[] = [];
  const ctx: BarCanvas = {
    fillStyle: '',
    setTransform: () => undefined,
    clearRect: () => {
      rects.length = 0;
    },
    fillRect(x, y, w, h) {
      rects.push({
        fill: typeof this.fillStyle === 'string' ? this.fillStyle : 'pattern',
        x,
        y,
        w,
        h,
      });
    },
  };
  return { ctx, rects };
}

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
});

function setup() {
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);
  const { clock, frame } = manualClock();
  const { ctx, rects } = fakeCanvas();
  const chart = new HistogramChart(host, {
    bins: 4,
    label: 'Hours',
    tick: (b) => `h${String(b)}`,
    tickEvery: 2,
    context: ctx,
    clock,
  });
  chart.resize(400, 100);
  const brushed: unknown[] = [];
  chart.onBrush((range) => brushed.push(range));
  return { chart, host, frame, rects, brushed };
}

/** Plain drag across the plot (jsdom has no layout: client coordinates are plot coordinates). */
function drag(host: HTMLElement, from: number, to: number) {
  const target = host.querySelector('.bp-histogram__brush .overlay');
  const event = (type: string, x: number) => {
    const e = new MouseEvent(type, { clientX: x, clientY: 50, bubbles: true });
    // d3-brush listens on `event.view`; see timeBrush.test.ts for why it's set like this.
    Object.defineProperty(e, 'view', { value: window });
    return e;
  };
  target?.dispatchEvent(event('mousedown', from));
  window.dispatchEvent(event('mousemove', to));
  window.dispatchEvent(event('mouseup', to));
}

describe('HistogramChart', () => {
  test('draws the totals faintly, then what passes, and follows new counts', () => {
    const { chart, frame, rects } = setup();
    chart.setCounts([10, 20, 0, 5], [10, 10, 0, 5]);
    frame();
    expect(rects).toHaveLength(8);
    const [totals, passing] = [rects.slice(0, 4), rects.slice(4)];
    expect(totals.map((r) => r.h)).toEqual([50, 100, 0, 25]);
    expect(passing.map((r) => r.h)).toEqual([50, 50, 0, 25]);
    expect(new Set(totals.map((r) => r.fill)).size).toBe(1);
    expect(totals[0]?.fill).not.toBe(passing[0]?.fill);

    chart.setCounts([10, 20, 0, 5], [0, 20, 0, 0]);
    frame();
    expect(rects.slice(4).map((r) => r.h)).toEqual([0, 100, 0, 0]);
  });

  test('labels every n-th bin on the x axis', () => {
    const { chart, host, frame } = setup();
    chart.setCounts([1, 1, 1, 1], [1, 1, 1, 1]);
    frame();
    const ticks = [...host.querySelectorAll('.bp-histogram__axes .tick text')].map(
      (t) => t.textContent,
    );
    expect(ticks).toEqual(expect.arrayContaining(['h0', 'h2']));
    expect(ticks).not.toContain('h1');
  });

  test('a drag reports the whole bins it touches, then snaps to their edges', () => {
    const { chart, host, brushed } = setup();
    // 4 bins over 400 px: 120–250 px touches bins 1 and 2.
    drag(host, 120, 250);
    expect(brushed.at(-1)).toEqual([1, 3]);
    expect(chart.brushRange).toEqual([1, 3]);
    const selection = host.querySelector('.bp-histogram__brush .selection');
    expect(Number(selection?.getAttribute('x'))).toBeCloseTo(100, 6);
    expect(Number(selection?.getAttribute('width'))).toBeCloseTo(200, 6);
  });

  test('the brush can be set before the chart has a size', () => {
    const host = document.createElement('div');
    document.body.append(host);
    hosts.push(host);
    const chart = new HistogramChart(host, { bins: 4, label: 'Hours', tick: String });
    expect(() => {
      chart.setBrush([1, 2]);
      chart.setBrush(null);
    }).not.toThrow();
    chart.destroy();
  });

  test('setting the brush is not reported', () => {
    const { chart, brushed } = setup();
    chart.setBrush([0, 2]);
    chart.setBrush(null);
    expect(brushed).toEqual([]);
    expect(chart.brushRange).toBeNull();
  });
});
