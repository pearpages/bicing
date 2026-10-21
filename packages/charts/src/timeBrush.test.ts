// @vitest-environment jsdom
import { allocateObservations, buildStationSeries, Status } from '@bicing/core';
import type { Renderer } from '@bicing/renderers';
import { afterEach, describe, expect, test } from 'vitest';
import type { FrameClock } from './scheduler';
import { testLocale } from './testLocale';
import { TimeSeriesChart } from './TimeSeriesChart';

const renderer = (): Renderer => ({
  kind: 'canvas',
  element: document.createElement('canvas'),
  maxPoints: Number.MAX_SAFE_INTEGER,
  setData: () => undefined,
  setColorScale: () => undefined,
  setDimmed: () => undefined,
  resize: () => undefined,
  render: () => ({ points: 0, drawCalls: 0 }),
  destroy: () => undefined,
});

/** Frames run only when the test says so; the brush is put back in place in the axes frame. */
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

/** One station, a reading every minute from t = 0 to 400. */
function series() {
  const obs = allocateObservations(401);
  for (let i = 0; i <= 400; i++) {
    obs.t[i] = i;
    obs.bikesMech[i] = 5;
    obs.status[i] = Status.InService;
  }
  return buildStationSeries(obs, {
    length: 1,
    ids: ['1'],
    names: ['A'],
    lat: new Float32Array(1),
    lon: new Float32Array(1),
    capacity: Uint8Array.of(20),
  });
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
  const chart = new TimeSeriesChart(host, {
    renderer: renderer(),
    locale: testLocale('en'),
    clock,
  });
  chart.resize(400, 200);
  chart.setData(series());
  frame();
  const brushed: unknown[] = [];
  chart.onBrush((range) => brushed.push(range));
  return { chart, host, brushed, frame };
}

/**
 * jsdom has no layout: every element sits at (0, 0), so client coordinates are plot coordinates.
 * d3-brush listens for the move and the release on the window, as in a browser.
 */
function drag(host: HTMLElement, from: number, to: number, shiftKey: boolean) {
  const target =
    host.querySelector('.bp-chart__brush .overlay') ?? host.querySelector('.bp-chart__overlay');
  // d3-brush listens on `event.view` for the move and the release. Vitest's jsdom window fails
  // the constructor's realm check for `view`, so the property is set on the event instead.
  const event = (type: string, x: number) => {
    const e = new MouseEvent(type, { clientX: x, clientY: 100, shiftKey, bubbles: true });
    Object.defineProperty(e, 'view', { value: window });
    return e;
  };
  target?.dispatchEvent(event('mousedown', from));
  window.dispatchEvent(event('mousemove', to));
  window.dispatchEvent(event('mouseup', to));
}

const selectionX = (host: HTMLElement) =>
  Number(host.querySelector('.bp-chart__brush .selection')?.getAttribute('x'));

describe('the time brush', () => {
  test('shift + drag brushes a range of minutes, reported live and at the end', () => {
    const { chart, host, brushed } = setup();
    chart.setBrushEnabled(true);
    drag(host, 100, 200, true);
    // 400 px for 400 minutes: pixels are minutes.
    expect(brushed.at(-1)).toEqual([100, 200]);
    expect(chart.brushRange).toEqual([100, 200]);
  });

  test('a plain drag is left to d3-zoom: it pans and brushes nothing', () => {
    const { chart, host, brushed } = setup();
    chart.setBrushEnabled(true);
    chart.zoomTo([0, 200]);
    drag(host, 100, 50, false);
    expect(brushed).toEqual([]);
    expect(chart.domain[0]).toBeGreaterThan(0);
  });

  test('the selection stays on its minutes when the view zooms', () => {
    const { chart, host, frame } = setup();
    chart.setBrushEnabled(true);
    drag(host, 100, 200, true);
    expect(selectionX(host)).toBeCloseTo(100, 6);
    chart.zoomTo([75, 275]);
    frame();
    // 200 minutes over 400 px: minute 100 is 25 minutes in, so 50 px.
    expect(selectionX(host)).toBeCloseTo(50, 6);
    chart.zoomTo([100, 300]);
    frame();
    expect(selectionX(host)).toBeCloseTo(0, 6);
    expect(chart.brushRange).toEqual([100, 200]);
  });

  test('setting or switching off the brush is not reported; switching off clears it', () => {
    const { chart, host, brushed } = setup();
    chart.setBrushEnabled(true);
    chart.setBrush([10, 20]);
    expect(chart.brushRange).toEqual([10, 20]);
    chart.setBrushEnabled(false);
    expect(chart.brushRange).toBeNull();
    // Disabled: shift + drag does nothing.
    drag(host, 100, 200, true);
    expect(brushed).toEqual([]);
  });
});
