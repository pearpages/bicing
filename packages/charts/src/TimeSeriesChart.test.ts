// @vitest-environment jsdom
import { allocateObservations, buildStationSeries, Status, type StationSeries } from '@bicing/core';
import type { LineSeriesData, Renderer, RenderStats, Viewport } from '@bicing/renderers';
import { afterEach, describe, expect, test } from 'vitest';
import type { FrameClock } from './scheduler';
import { testLocale } from './testLocale';
import { TimeSeriesChart, type FrameReport } from './TimeSeriesChart';

function fakeRenderer(kind: Renderer['kind'] = 'canvas', maxPoints = Number.MAX_SAFE_INTEGER) {
  const uploads: LineSeriesData[] = [];
  const views: Viewport[] = [];
  let destroyed = false;
  const renderer: Renderer = {
    kind,
    element: document.createElement('canvas'),
    maxPoints,
    setData: (data) => uploads.push(data),
    setColorScale: () => undefined,
    resize: () => undefined,
    render: (view): RenderStats => {
      views.push(view);
      const last = uploads[uploads.length - 1];
      return { points: last?.x.length ?? 0, drawCalls: 1 };
    },
    destroy: () => {
      destroyed = true;
    },
  };
  return { renderer, uploads, views, isDestroyed: () => destroyed };
}

/** Frames only happen when the test says so. */
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

/** 10 stations sampled every `step` minutes, in store order, with a deterministic wiggle. Core-only (P10). */
function dataset(rows: number, step = 5): StationSeries {
  const stationCount = 10;
  const obs = allocateObservations(rows);
  for (let i = 0; i < rows; i++) {
    const s = i % stationCount;
    obs.stationIdx[i] = s;
    obs.t[i] = Math.floor(i / stationCount) * step;
    obs.bikesMech[i] = (s * 7 + ((i * 2654435761) >>> 27)) % 30;
    obs.status[i] = Status.InService;
  }
  const stations = {
    length: stationCount,
    ids: [],
    names: [],
    lat: new Float32Array(stationCount),
    lon: new Float32Array(stationCount),
    capacity: new Uint8Array(stationCount).fill(30),
  };
  return buildStationSeries(obs, stations);
}

const hosts: HTMLElement[] = [];
function setup(
  options: { decimation?: 'none' | 'minmax' | 'lttb'; maxPoints?: number; budget?: number } = {},
) {
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);
  const fake = fakeRenderer('canvas', options.maxPoints);
  const { clock, frame } = manualClock();
  const chart = new TimeSeriesChart(host, {
    renderer: fake.renderer,
    decimation: options.decimation ?? 'none',
    locale: testLocale('en'),
    clock,
    ...(options.budget === undefined ? {} : { liveDecimationBudget: options.budget }),
  });
  const reports: FrameReport[] = [];
  chart.onFrame((r) => reports.push(r));
  chart.resize(400, 200);
  return { chart, host, fake, frame, reports };
}

afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
});

describe('TimeSeriesChart', () => {
  test('builds the layered DOM with a labelled root', () => {
    const { host } = setup();
    const root = host.querySelector('.bp-chart');
    expect(root?.getAttribute('role')).toBe('img');
    expect(root?.querySelector('.bp-chart__plot .bp-chart__data')).not.toBeNull();
    expect(root?.querySelector('svg.bp-chart__axes')).not.toBeNull();
    expect(root?.querySelector('.bp-chart__overlay')).not.toBeNull();
  });

  test('without decimation, uploads the full-resolution lines once and reuses them', () => {
    const { chart, fake, frame, reports } = setup();
    const series = dataset(20_000);
    chart.setData(series);
    frame();
    expect(fake.uploads).toHaveLength(1);
    expect(fake.uploads[0]?.x).toBe(series.x);
    chart.zoomTo([series.xMin, series.xMin + 600]);
    frame();
    expect(fake.uploads).toHaveLength(1);
    expect(reports.at(-1)).toMatchObject({
      uploadedPoints: series.x.length,
      stale: false,
      skipped: null,
    });
  });

  test('draws axes with ticks', () => {
    const { chart, host, frame } = setup();
    chart.setData(dataset(5_000));
    frame();
    expect(host.querySelectorAll('.bp-chart__axis--x .tick').length).toBeGreaterThan(1);
    expect(host.querySelectorAll('.bp-chart__axis--y .tick').length).toBeGreaterThan(1);
  });

  test('min/max decimation uploads far fewer points and re-decimates on zoom', () => {
    const { chart, fake, frame, reports } = setup({ decimation: 'minmax' });
    const series = dataset(200_000);
    chart.setData(series);
    frame();
    const first = reports.at(-1);
    expect(first?.uploadedPoints).toBeLessThan(series.x.length / 2);
    chart.zoomTo([series.xMin, series.xMin + 24 * 60]);
    frame();
    expect(fake.uploads.length).toBe(2);
    expect(fake.uploads[1]?.x[0]).toBeLessThanOrEqual(series.xMin + 24 * 60);
  });

  test('during a gesture over too many points, keeps the stale decimation and refines when it ends', () => {
    const { chart, fake, frame, reports } = setup({ decimation: 'minmax', budget: 1_000 });
    const series = dataset(50_000);
    chart.setData(series);
    frame();
    chart.setInteracting(true);
    chart.zoomTo([series.xMin, series.xMax - 600]);
    frame();
    expect(reports.at(-1)?.stale).toBe(true);
    expect(fake.uploads).toHaveLength(1);
    chart.setInteracting(false);
    frame();
    expect(reports.at(-1)?.stale).toBe(false);
    expect(fake.uploads).toHaveLength(2);
  });

  test('reports "skipped" instead of handing a renderer more than its cap', () => {
    const { chart, fake, frame, reports } = setup({ maxPoints: 1_000 });
    chart.setData(dataset(20_000));
    frame();
    expect(reports.at(-1)?.skipped).toMatch(/capped at 1,000 points/);
    expect(fake.uploads.at(-1)?.x.length).toBe(0);
  });

  test('zoomTo clamps to the minimum span and notifies view listeners', () => {
    const { chart } = setup();
    const series = dataset(20_000);
    chart.setData(series);
    const views: (readonly [number, number])[] = [];
    chart.onView((d) => views.push(d));
    chart.zoomTo([series.xMin + 100, series.xMin + 101]);
    const [d0, d1] = chart.domain;
    expect(d1 - d0).toBeCloseTo(30, 5);
    expect(views.length).toBeGreaterThan(0);
  });

  test('setRenderer destroys the old renderer and uploads to the new one', () => {
    const { chart, fake, frame } = setup();
    chart.setData(dataset(5_000));
    frame();
    const next = fakeRenderer('webgl');
    chart.setRenderer(next.renderer);
    frame();
    expect(fake.isDestroyed()).toBe(true);
    expect(next.uploads).toHaveLength(1);
    expect(chart.rendererKind).toBe('webgl');
  });

  test('hover picks a sample, shows the described tooltip, and hides on leave', () => {
    const host = document.createElement('div');
    document.body.append(host);
    hosts.push(host);
    const { clock, frame } = manualClock();
    const chart = new TimeSeriesChart(host, {
      renderer: fakeRenderer().renderer,
      locale: testLocale('en'),
      clock,
      describe: (hit) => [`station ${String(hit.station)}`, `${String(hit.y)} bikes`],
    });
    chart.resize(400, 200);
    chart.setData(dataset(2_000));
    const hits: unknown[] = [];
    chart.onHover((hit) => hits.push(hit));
    frame();

    const overlay = host.querySelector('.bp-chart__overlay');
    const group = host.querySelector('.bp-chart__hover');
    // jsdom has no layout, so the overlay sits at (0, 0) and client coordinates are plot coordinates.
    overlay?.dispatchEvent(
      new MouseEvent('pointermove', { clientX: 200, clientY: 100, bubbles: true }),
    );
    frame();
    expect(hits.at(-1)).toMatchObject({ station: expect.any(Number) as number });
    expect(group?.getAttribute('visibility')).toBe('visible');
    expect(host.querySelector('.bp-chart__tooltip-text')?.textContent).toMatch(
      /^station \d+\d+ bikes$/,
    );

    overlay?.dispatchEvent(new MouseEvent('pointerleave', { bubbles: true }));
    frame();
    expect(hits.at(-1)).toBeNull();
    expect(group?.getAttribute('visibility')).toBe('hidden');
  });

  test('the axis and the default tooltip speak the locale', () => {
    const host = document.createElement('div');
    document.body.append(host);
    hosts.push(host);
    const { clock, frame } = manualClock();
    const chart = new TimeSeriesChart(host, {
      renderer: fakeRenderer().renderer,
      locale: testLocale('ca'),
      clock,
    });
    chart.resize(400, 200);
    // Twelve-hour samples over ~100 days from 2018-01-01: the ticks land on months.
    chart.setData(dataset(2_000, 12 * 60));
    frame();
    const ticks = [...host.querySelectorAll('.bp-chart__axis--x .tick text')].map(
      (tick) => tick.textContent,
    );
    expect(ticks).toEqual(expect.arrayContaining(['febrer', 'març']));
    expect(host.querySelector('.bp-chart')?.getAttribute('aria-label')).toBe(
      'Bicicletes disponibles per estació al llarg del temps',
    );

    // Dense samples (as in the hover test) so the pointer lands on a line.
    chart.setData(dataset(2_000));
    frame();
    host
      .querySelector('.bp-chart__overlay')
      ?.dispatchEvent(new MouseEvent('pointermove', { clientX: 200, clientY: 100, bubbles: true }));
    frame();
    expect(host.querySelector('.bp-chart__tooltip-text')?.textContent).toMatch(
      /^Estació \d+(dg|dl|dt|dc|dj|dv|ds)\. \d+ [a-zç.]+ 2018, \d\d:\d\d UTC\d+ bicicletes$/,
    );
  });

  test('setLocale redraws the axes and messages without re-uploading', () => {
    const { chart, host, fake, frame, reports } = setup({ maxPoints: 1_000 });
    chart.setLocale(testLocale('ca'));
    chart.setData(dataset(20_000));
    frame();
    expect(reports.at(-1)?.skipped).toBe(
      "CANVAS: com a màxim 1.000 punts (se n'han demanat 20.000)",
    );
    const uploads = fake.uploads.length;

    chart.setLocale(testLocale('en'));
    frame();
    expect(fake.uploads).toHaveLength(uploads);
    expect(reports.at(-1)?.skipped).toBe('CANVAS is capped at 1,000 points (20,000 requested)');
    expect(host.querySelector('.bp-chart')?.getAttribute('aria-label')).toBe(
      'Bikes available per station over time',
    );
  });

  test('switching locale on uploaded data keeps the upload', () => {
    const { chart, host, fake, frame } = setup();
    chart.setData(dataset(2_000, 12 * 60));
    frame();
    const before = [...host.querySelectorAll('.bp-chart__axis--x .tick text')].map(
      (tick) => tick.textContent,
    );
    chart.setLocale(testLocale('ca'));
    frame();
    const after = [...host.querySelectorAll('.bp-chart__axis--x .tick text')].map(
      (tick) => tick.textContent,
    );
    expect(before).toContain('February');
    expect(after).toContain('febrer');
    expect(fake.uploads).toHaveLength(1);
  });

  test('setData with an extent and keepView swaps data without moving the view', () => {
    const { chart, fake, frame } = setup();
    const coarse = dataset(2_000, 60);
    const extent = [coarse.xMin, coarse.xMax] as const;
    chart.setData(coarse, { extent });
    frame();
    const view = [coarse.xMin + 1_000, coarse.xMin + 3_000] as const;
    chart.zoomTo(view);
    // A finer level for just the visible window: the zoom limits stay the coverage's.
    const fine = dataset(2_000, 1);
    chart.setData(fine, { extent, keepView: true });
    frame();
    expect(chart.domain[0]).toBeCloseTo(view[0], 6);
    expect(chart.domain[1]).toBeCloseTo(view[1], 6);
    expect(chart.extent).toEqual(extent);
    expect(fake.uploads.at(-1)?.x.length).toBe(fine.x.length);
  });

  test('without keepView, new data resets the zoom to its extent', () => {
    const { chart } = setup();
    const series = dataset(2_000, 60);
    chart.setData(series);
    chart.zoomTo([series.xMin + 1_000, series.xMin + 3_000]);
    chart.setData(dataset(2_000, 60));
    expect(chart.domain[0]).toBeCloseTo(series.xMin, 6);
    expect(chart.domain[1]).toBeCloseTo(series.xMax, 6);
  });

  test('gaps are shaded, and hovering inside one explains it instead of picking a line', () => {
    const host = document.createElement('div');
    document.body.append(host);
    hosts.push(host);
    const { clock, frame } = manualClock();
    const chart = new TimeSeriesChart(host, {
      renderer: fakeRenderer().renderer,
      locale: testLocale('en'),
      clock,
    });
    chart.resize(400, 200);
    const series = dataset(2_000);
    chart.setData(series);
    const mid = (series.xMin + series.xMax) / 2;
    chart.setGaps([{ t0: mid - 100, t1: mid + 100, note: 'Archive missing' }]);
    const hits: unknown[] = [];
    chart.onHover((hit) => hits.push(hit));
    frame();
    expect(host.querySelectorAll('.bp-chart__gap')).toHaveLength(1);

    const overlay = host.querySelector('.bp-chart__overlay');
    // The middle of the plot is the middle of the gap.
    overlay?.dispatchEvent(
      new MouseEvent('pointermove', { clientX: 200, clientY: 100, bubbles: true }),
    );
    frame();
    expect(hits.at(-1) ?? null).toBeNull();
    expect(host.querySelector('.bp-chart__tooltip-text')?.textContent).toMatch(
      /^No data.*Archive missing$/,
    );
    expect(host.querySelector('.bp-chart__marker')?.getAttribute('visibility')).toBe('hidden');

    // Outside the gap, hover picks a station again and shows its marker.
    overlay?.dispatchEvent(
      new MouseEvent('pointermove', { clientX: 20, clientY: 100, bubbles: true }),
    );
    frame();
    expect(host.querySelector('.bp-chart__tooltip-text')?.textContent).toMatch(/^Station \d+/);
    expect(host.querySelector('.bp-chart__marker')?.getAttribute('visibility')).toBe('inherit');
  });

  test('a gap too narrow to aim at is shaded but does not take over the tooltip', () => {
    const { chart, host, frame } = setup();
    const series = dataset(2_000);
    chart.setData(series);
    const mid = (series.xMin + series.xMax) / 2;
    // The plot is 400 px wide: a 2-minute gap here is well under 4 px.
    chart.setGaps([{ t0: mid - 1, t1: mid + 1 }]);
    frame();
    expect(host.querySelectorAll('.bp-chart__gap')).toHaveLength(1);
    host
      .querySelector('.bp-chart__overlay')
      ?.dispatchEvent(new MouseEvent('pointermove', { clientX: 200, clientY: 100, bubbles: true }));
    frame();
    expect(host.querySelector('.bp-chart__tooltip-text')?.textContent).toMatch(/^Station \d+/);
  });

  test('destroy removes the DOM and stops drawing', () => {
    const { chart, host, fake, frame } = setup();
    chart.setData(dataset(5_000));
    chart.destroy();
    frame();
    expect(host.querySelector('.bp-chart')).toBeNull();
    expect(fake.isDestroyed()).toBe(true);
    expect(fake.views).toHaveLength(0);
  });
});
