// @vitest-environment jsdom
import type { StationTable } from '@bicing/core';
import type { PointRenderer } from '@bicing/renderers';
import { afterEach, describe, expect, test } from 'vitest';
import type { FrameClock } from './scheduler';
import { StationMap } from './StationMap';

function fakeRenderer() {
  const calls = { positions: [] as [number[], number[]][], values: [] as number[][], renders: 0 };
  const dims: (number[] | null)[] = [];
  const renderer: PointRenderer = {
    element: document.createElement('canvas'),
    setPositions: (x, y) => calls.positions.push([Array.from(x), Array.from(y)]),
    setValues: (values) => calls.values.push(Array.from(values)),
    setColorScale: () => undefined,
    setNoDataColor: () => undefined,
    setDimmed: (points) => dims.push(points ? Array.from(points) : null),
    resize: () => undefined,
    render: () => {
      calls.renders++;
    },
    destroy: () => undefined,
  };
  return { renderer, calls, dims };
}

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

/** Three stations in a line west → east, and one without coordinates. */
const STATIONS: StationTable = {
  length: 4,
  ids: ['1', '2', '3', '4'],
  names: ['West', 'Middle', 'East', 'Nowhere'],
  lat: Float32Array.of(41.39, 41.39, 41.39, Number.NaN),
  lon: Float32Array.of(2.1, 2.15, 2.2, Number.NaN),
  capacity: Uint8Array.of(20, 20, 20, 20),
};

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
});

function setup() {
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);
  const fake = fakeRenderer();
  const { clock, frame } = manualClock();
  const map = new StationMap(host, {
    renderer: fake.renderer,
    label: 'Stations',
    describe: (station) => [STATIONS.names[station] ?? '?', 'half full'],
    clock,
  });
  map.resize(200, 100);
  map.setStations(STATIONS);
  frame();
  return { map, host, fake, frame };
}

/** jsdom has no layout: the plot sits at (0, 0), so client coordinates are plot coordinates. */
const move = (host: HTMLElement, x: number, y: number) =>
  host
    .querySelector('.bp-map')
    ?.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y, bubbles: true }));

describe('StationMap', () => {
  test('projects stations west to east inside the padding; one without coordinates is parked', () => {
    const { fake } = setup();
    const [x = [], y = []] = fake.calls.positions.at(-1) ?? [];
    expect(x[0]).toBeCloseTo(12, 0);
    expect(x[2]).toBeCloseTo(188, 0);
    expect((x[0] ?? 0) < (x[1] ?? 0) && (x[1] ?? 0) < (x[2] ?? 0)).toBe(true);
    expect(y[1]).toBeCloseTo(50, 0);
    expect([x[3], y[3]]).toEqual([-1_000, -1_000]);
  });

  test('new values only re-upload values and redraw', () => {
    const { map, fake, frame } = setup();
    const positions = fake.calls.positions.length;
    const renders = fake.calls.renders;
    map.setValues([0.5, Number.NaN, 1, 0]);
    frame();
    expect(fake.calls.values.at(-1)).toEqual([0.5, Number.NaN, 1, 0]);
    expect(fake.calls.positions).toHaveLength(positions);
    expect(fake.calls.renders).toBe(renders + 1);
  });

  test('hover picks the nearest station within reach and describes it', () => {
    const { map, host, frame } = setup();
    const hovered: (number | null)[] = [];
    map.onHover((station) => hovered.push(station));
    move(host, 98, 52);
    frame();
    expect(hovered.at(-1)).toBe(1);
    expect(host.querySelector('.bp-map__tooltip-text')?.textContent).toBe('Middlehalf full');
    expect(Number(host.querySelector('.bp-map__ring')?.getAttribute('cx'))).toBeCloseTo(100, 2);

    // Far from every station: nothing is picked and the hover hides.
    move(host, 100, 5);
    frame();
    expect(hovered.at(-1)).toBeNull();
    expect(host.querySelector('.bp-map svg g')?.getAttribute('visibility')).toBe('hidden');
  });

  test('a click reports the station under it, or null on empty map', () => {
    const { map, host } = setup();
    const clicked: (number | null)[] = [];
    map.onClick((station) => clicked.push(station));
    const click = (x: number, y: number) =>
      host
        .querySelector('.bp-map')
        ?.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, bubbles: true }));
    click(98, 52);
    click(100, 5);
    expect(clicked).toEqual([1, null]);
  });

  test('dimmed stations go to the renderer and redraw', () => {
    const { map, fake, frame } = setup();
    const renders = fake.calls.renders;
    map.setDimmedStations(Uint8Array.of(0, 1, 0, 0));
    frame();
    expect(fake.dims.at(-1)).toEqual([0, 1, 0, 0]);
    expect(fake.calls.renders).toBe(renders + 1);
  });

  test('destroy removes the DOM', () => {
    const { map, host } = setup();
    map.destroy();
    expect(host.querySelector('.bp-map')).toBeNull();
  });
});
