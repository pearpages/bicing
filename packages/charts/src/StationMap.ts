import type { StationTable } from '@bicing/core';
import type { PointRenderer } from '@bicing/renderers';
import { geoMercator } from 'd3-geo';
import Flatbush from 'flatbush';
import { FrameScheduler, type FrameClock } from './scheduler';
import { createTooltip, placeTooltip, type TooltipDom } from './tooltip';

/** Within this many CSS pixels of a station, hovering picks it. */
const PICK_RADIUS_PX = 12;
/** Room around the stations, so edge points and their rings aren't clipped. */
const PADDING_PX = 12;
const SVG_NS = 'http://www.w3.org/2000/svg';

export interface StationMapOptions {
  readonly renderer: PointRenderer;
  /** The map's accessible name. */
  readonly label: string;
  /** Tooltip lines for a hovered station; the app knows names and the moment shown. */
  readonly describe: (station: number) => readonly string[];
  /** For tests. Defaults to requestAnimationFrame. */
  readonly clock?: FrameClock;
}

type Listener = (station: number | null) => void;

/**
 * Every station as a point at its position, colored by how full it is at one moment (T2.7). D3
 * projects (d3-geo, P3), a PointRenderer draws, and Flatbush answers "which station is under the
 * pointer" (ADR 0008). Framework-agnostic and driven through methods, like TimeSeriesChart (P11).
 */
export class StationMap {
  private readonly root: HTMLDivElement;
  private readonly plot: HTMLDivElement;
  private readonly ring: SVGCircleElement;
  private readonly hover: SVGGElement;
  private readonly tooltip: TooltipDom;
  private readonly renderer: PointRenderer;
  private readonly describe: (station: number) => readonly string[];
  private readonly scheduler: FrameScheduler<'points' | 'hover'>;
  private readonly resizeObserver: ResizeObserver | null;
  private readonly listeners = new Set<Listener>();
  private stations: StationTable | null = null;
  private x = new Float32Array(0);
  private y = new Float32Array(0);
  /** Flatbush ids are positions in `indexed`, which holds the stations that have coordinates. */
  private index: Flatbush | null = null;
  private indexed: number[] = [];
  private pointer: readonly [number, number] | null = null;
  private hovered: number | null = null;
  private width = 0;
  private height = 0;

  constructor(host: HTMLElement, options: StationMapOptions) {
    this.renderer = options.renderer;
    this.describe = options.describe;
    this.root = document.createElement('div');
    this.root.className = 'bp-map';
    this.root.setAttribute('role', 'img');
    this.root.setAttribute('aria-label', options.label);
    this.plot = document.createElement('div');
    this.plot.className = 'bp-map__plot';
    this.renderer.element.classList.add('bp-map__points');
    this.plot.append(this.renderer.element);

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'bp-map__overlay');
    this.hover = document.createElementNS(SVG_NS, 'g');
    this.hover.setAttribute('visibility', 'hidden');
    this.ring = document.createElementNS(SVG_NS, 'circle');
    this.ring.setAttribute('class', 'bp-map__ring');
    this.ring.setAttribute('r', '7');
    this.tooltip = createTooltip('bp-map__tooltip');
    this.hover.append(this.ring, this.tooltip.tooltip);
    svg.append(this.hover);
    this.root.append(this.plot, svg);
    host.append(this.root);

    this.scheduler = new FrameScheduler<'points' | 'hover'>((dirty) => {
      if (dirty.has('points')) this.renderer.render();
      if (dirty.has('hover')) this.drawHover();
    }, options.clock);
    this.root.addEventListener('pointermove', this.onPointerMove);
    this.root.addEventListener('pointerleave', this.onPointerLeave);
    this.resizeObserver =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver((entries) => {
            const box = entries[0]?.contentRect;
            if (box) this.resize(box.width, box.height);
          })
        : null;
    this.resizeObserver?.observe(this.plot);
  }

  /** New station table: positions are projected again and the hover index rebuilt. */
  setStations(stations: StationTable): void {
    this.stations = stations;
    this.project();
  }

  /** Fill per station in [0, 1], NaN for no data (`fillAt`). Only the values are uploaded. */
  setValues(values: ArrayLike<number>): void {
    this.renderer.setValues(values);
    this.scheduler.invalidate('points', 'hover');
  }

  /** One flag per station, 1 = filtered out (ADR 0015): drawn faint, still hoverable. */
  setDimmedStations(dimmed: Uint8Array | null): void {
    this.renderer.setDimmed(dimmed);
    this.scheduler.invalidate('points');
  }

  /** The app calls this on a theme change too, which is when the no-data color may change. */
  setColorScale(interpolate: (t: number) => string): void {
    this.renderer.setColorScale(interpolate);
    this.applyNoDataColor();
    this.scheduler.invalidate('points');
  }

  setLabel(label: string): void {
    this.root.setAttribute('aria-label', label);
  }

  /** The tooltip's wording changed (a new moment, another language): redraw it. */
  refreshTooltip(): void {
    this.scheduler.invalidate('hover');
  }

  /** The hovered station, or null. Fires only when it changes. */
  onHover(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Resizes to the plot box. Called by the ResizeObserver; public for environments without one. */
  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.renderer.resize(
      width,
      height,
      typeof devicePixelRatio === 'number' ? devicePixelRatio : 1,
    );
    this.project();
  }

  destroy(): void {
    this.scheduler.destroy();
    this.resizeObserver?.disconnect();
    this.root.removeEventListener('pointermove', this.onPointerMove);
    this.root.removeEventListener('pointerleave', this.onPointerLeave);
    this.renderer.destroy();
    this.root.remove();
    this.listeners.clear();
  }

  /** Stations' pixel positions for the current size, the renderer's buffer and the hover index. */
  private project(): void {
    const { stations } = this;
    if (!stations || this.width <= 0 || this.height <= 0) return;
    const located: number[] = [];
    for (let s = 0; s < stations.length; s++)
      if (Number.isFinite(stations.lon[s]) && Number.isFinite(stations.lat[s])) located.push(s);
    const projection = geoMercator();
    if (located.length > 0)
      projection.fitExtent(
        [
          [PADDING_PX, PADDING_PX],
          [this.width - PADDING_PX, this.height - PADDING_PX],
        ],
        {
          type: 'MultiPoint',
          coordinates: located.map((s) => [stations.lon[s] as number, stations.lat[s] as number]),
        },
      );
    // A station without coordinates is parked off-screen and left out of the hover index.
    this.x = new Float32Array(stations.length).fill(-1_000);
    this.y = new Float32Array(stations.length).fill(-1_000);
    const index = located.length > 0 ? new Flatbush(located.length) : null;
    for (const s of located) {
      const [px, py] = projection([stations.lon[s] as number, stations.lat[s] as number]) ?? [
        -1_000, -1_000,
      ];
      this.x[s] = px;
      this.y[s] = py;
      index?.add(px, py, px, py);
    }
    index?.finish();
    this.index = index;
    this.indexed = located;
    this.renderer.setPositions(this.x, this.y);
    this.applyNoDataColor();
    this.scheduler.invalidate('points', 'hover');
  }

  /** "No data" is themed in CSS (`--bp-map-no-data`, a hex color), like the rest of the chart (P16). */
  private applyNoDataColor(): void {
    const color = getComputedStyle(this.root).getPropertyValue('--bp-map-no-data').trim();
    if (/^#[0-9a-f]{6}$/i.test(color)) this.renderer.setNoDataColor(color);
  }

  private drawHover(): void {
    const { pointer, index } = this;
    const found =
      pointer && index ? index.neighbors(pointer[0], pointer[1], 1, PICK_RADIUS_PX)[0] : undefined;
    const station = found === undefined ? null : (this.indexed[found] ?? null);
    if (station !== this.hovered) {
      this.hovered = station;
      for (const listener of this.listeners) listener(station);
    }
    if (station === null) {
      this.hover.setAttribute('visibility', 'hidden');
      return;
    }
    const px = this.x[station] as number;
    const py = this.y[station] as number;
    this.hover.setAttribute('visibility', 'visible');
    this.ring.setAttribute('cx', String(px));
    this.ring.setAttribute('cy', String(py));
    placeTooltip(this.tooltip, this.describe(station), px, py, this.width, this.height);
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    const box = this.plot.getBoundingClientRect();
    this.pointer = [event.clientX - box.left, event.clientY - box.top];
    this.scheduler.invalidate('hover');
  };

  private readonly onPointerLeave = (): void => {
    this.pointer = null;
    this.scheduler.invalidate('hover');
  };
}
