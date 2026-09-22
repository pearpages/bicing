import { toEpochMs, type StationSeries } from '@bicing/core';
import {
  EMPTY_LINES,
  type LineSeriesData,
  type Renderer,
  type RendererKind,
} from '@bicing/renderers';
import { axisBottom, axisLeft } from 'd3-axis';
import { scaleLinear, scaleUtc } from 'd3-scale';
import { select } from 'd3-selection';
import {
  zoom,
  zoomIdentity,
  type D3ZoomEvent,
  type ZoomBehavior,
  type ZoomTransform,
} from 'd3-zoom';
import { createChartDom, type ChartDom } from './layers';
import { decimatedLines, fullLines, visiblePointCount, type Decimation } from './lines';
import { FrameScheduler, type FrameClock } from './scheduler';

type Layer = 'data' | 'axes';
type Domain = readonly [number, number];

/**
 * Re-decimating costs about 3 ns per visible point (ADR 0006). 2M points is about 6 ms, which still fits
 * a 60 fps frame next to rendering. Above that, a gesture keeps drawing the last decimation and
 * refines when it ends.
 */
const LIVE_DECIMATION_BUDGET = 2_000_000;

/** Everything the benchmark overlay needs to know about one frame. */
export interface FrameReport {
  readonly renderer: RendererKind;
  readonly decimation: Decimation;
  /** In-service readings in the dataset. */
  readonly totalPoints: number;
  /** Points handed to the renderer (after decimation), and what it drew after culling. */
  readonly uploadedPoints: number;
  readonly drawnPoints: number;
  readonly drawCalls: number;
  /** Decimation + upload time this frame (0 when the renderer's data was reused). */
  readonly prepareMs: number;
  /** Renderer.render() CPU time. For WebGL, the GPU time isn't included (it's async). */
  readonly renderMs: number;
  /** True while a gesture draws the previous decimation (refined when the gesture ends). */
  readonly stale: boolean;
  /** Why the renderer is showing nothing, e.g. its point cap was exceeded. */
  readonly skipped: string | null;
}

export interface TimeSeriesChartOptions {
  readonly renderer: Renderer;
  readonly decimation?: Decimation;
  /** Maps a station's mean fill (0–1) to a CSS color. The app picks a ramp per theme. */
  readonly colorScale?: (t: number) => string;
  /** The narrowest zoom, in minutes. */
  readonly minSpanMinutes?: number;
  readonly label?: string;
  /** Visible points above which a gesture keeps the stale decimation. Defaults to 2M (ADR 0006). */
  readonly liveDecimationBudget?: number;
  /** For tests. Defaults to requestAnimationFrame. */
  readonly clock?: FrameClock;
}

type Listener<T> = (value: T) => void;

/**
 * Framework-agnostic time series controller. D3 does the math (d3-scale for the mappings, d3-axis for
 * the axes, d3-zoom for the interaction), and a Renderer draws the marks. Everything is driven through
 * imperative methods, so a UI framework never has to re-render because data changed (P11).
 */
export class TimeSeriesChart {
  private readonly dom: ChartDom;
  private readonly scheduler: FrameScheduler<Layer>;
  private readonly zoomBehavior: ZoomBehavior<HTMLDivElement, unknown>;
  private readonly resizeObserver: ResizeObserver | null;
  private readonly minSpan: number;
  private readonly liveBudget: number;
  private readonly frameListeners = new Set<Listener<FrameReport>>();
  private readonly viewListeners = new Set<Listener<Domain>>();

  private renderer: Renderer;
  private decimation: Decimation;
  private colorScale: (t: number) => string;
  private series: StationSeries | null = null;
  private full: LineSeriesData = EMPTY_LINES;
  private fullDomain: Domain = [0, 1];
  private transform: ZoomTransform = zoomIdentity;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private dprQuery: MediaQueryList | null = null;

  /** What the renderer currently holds, and for which decimation request (null = full resolution). */
  private uploaded: LineSeriesData | null = null;
  private uploadedKey: string | null = null;
  private skipped: string | null = null;
  private interacting = false;

  constructor(host: HTMLElement, options: TimeSeriesChartOptions) {
    this.dom = createChartDom(host, options.label ?? 'Bikes available per station over time');
    this.renderer = options.renderer;
    this.decimation = options.decimation ?? 'none';
    this.colorScale = options.colorScale ?? (() => 'rgb(42, 120, 214)');
    this.minSpan = options.minSpanMinutes ?? 30;
    this.liveBudget = options.liveDecimationBudget ?? LIVE_DECIMATION_BUDGET;
    this.scheduler = new FrameScheduler<Layer>((dirty) => {
      this.draw(dirty);
    }, options.clock);

    this.mountRenderer();

    this.zoomBehavior = zoom<HTMLDivElement, unknown>()
      .scaleExtent([1, 1])
      .on('start', (event: D3ZoomEvent<HTMLDivElement, unknown>) => {
        // Programmatic zooms have no sourceEvent; only real gestures switch to the live policy.
        if (event.sourceEvent) this.interacting = true;
      })
      .on('zoom', (event: D3ZoomEvent<HTMLDivElement, unknown>) => {
        this.transform = event.transform;
        this.scheduler.invalidate('data', 'axes');
        this.emitView();
      })
      .on('end', (event: D3ZoomEvent<HTMLDivElement, unknown>) => {
        if (event.sourceEvent) this.setInteracting(false);
      });
    select(this.dom.overlay).call(this.zoomBehavior);

    this.resizeObserver =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver((entries) => {
            const box = entries[0]?.contentRect;
            if (box) this.resize(box.width, box.height);
          })
        : null;
    this.resizeObserver?.observe(this.dom.plot);
    this.watchDevicePixelRatio();
  }

  /** New dataset. Resets the zoom to the full extent. */
  setData(series: StationSeries | null): void {
    this.series = series;
    this.full = series ? fullLines(series) : EMPTY_LINES;
    this.fullDomain = series && series.xMax > series.xMin ? [series.xMin, series.xMax] : [0, 1];
    this.uploaded = null;
    this.uploadedKey = null;
    if (!series) {
      this.renderer.setData(EMPTY_LINES);
      this.renderer.render(this.viewport(this.fullDomain));
      for (const g of [this.dom.xAxis, this.dom.yAxis, this.dom.grid]) g.replaceChildren();
    }
    this.updateZoomExtents();
    this.zoomBehavior.transform(select(this.dom.overlay), zoomIdentity);
    this.scheduler.invalidate('data', 'axes');
  }

  /** Swaps the drawing technology on the same data (benchmark mode). The old renderer is destroyed. */
  setRenderer(renderer: Renderer): void {
    this.renderer.destroy();
    this.renderer = renderer;
    this.mountRenderer();
    this.uploaded = null;
    this.uploadedKey = null;
    this.scheduler.invalidate('data');
  }

  setDecimation(decimation: Decimation): void {
    if (decimation === this.decimation) return;
    this.decimation = decimation;
    this.uploaded = null;
    this.uploadedKey = null;
    this.scheduler.invalidate('data');
  }

  setColorScale(colorScale: (t: number) => string): void {
    this.colorScale = colorScale;
    this.renderer.setColorScale(colorScale);
    this.scheduler.invalidate('data');
  }

  /** The visible x-domain, in minutes since the epoch. */
  get domain(): Domain {
    if (this.width <= 0) return this.fullDomain;
    const [d0, d1] = this.transform.rescaleX(this.baseX()).domain();
    return [d0 ?? this.fullDomain[0], d1 ?? this.fullDomain[1]];
  }

  get extent(): Domain {
    return this.fullDomain;
  }

  get rendererKind(): RendererKind {
    return this.renderer.kind;
  }

  /** Programmatic zoom (the scripted benchmark, "reset" buttons). Clamped like a gesture. */
  zoomTo(domain: Domain): void {
    if (this.width <= 0) return;
    const span = Math.max(domain[1] - domain[0], this.minSpan);
    const k = (this.fullDomain[1] - this.fullDomain[0]) / span;
    const tx = -this.baseX()(domain[0]) * k;
    this.zoomBehavior.transform(select(this.dom.overlay), zoomIdentity.translate(tx, 0).scale(k));
  }

  /**
   * Treat the following zooms as one gesture: while it's active, decimation may stay stale
   * instead of blowing the frame budget. User gestures set this automatically. The scripted
   * benchmark sets it by hand, so it gets the same policy.
   */
  setInteracting(interacting: boolean): void {
    const ended = this.interacting && !interacting;
    this.interacting = interacting;
    if (ended) this.scheduler.invalidate('data');
  }

  onFrame(listener: Listener<FrameReport>): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  onView(listener: Listener<Domain>): () => void {
    this.viewListeners.add(listener);
    return () => this.viewListeners.delete(listener);
  }

  /** Resizes to the plot box. Called by the ResizeObserver; public for environments without one. */
  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    const keep = this.width > 0 ? this.domain : null;
    this.width = width;
    this.height = height;
    this.renderer.resize(width, height, this.dpr);
    this.updateZoomExtents();
    if (keep) this.zoomTo(keep);
    this.scheduler.invalidate('data', 'axes');
    // Resizing a canvas clears it; draw now rather than show one blank frame.
    this.scheduler.flush();
  }

  destroy(): void {
    this.scheduler.destroy();
    this.resizeObserver?.disconnect();
    this.dprQuery?.removeEventListener('change', this.onDevicePixelRatioChange);
    select(this.dom.overlay).on('.zoom', null);
    this.renderer.destroy();
    this.dom.root.remove();
    this.frameListeners.clear();
    this.viewListeners.clear();
  }

  private mountRenderer(): void {
    this.renderer.element.classList.add('bp-chart__data');
    this.dom.plot.replaceChildren(this.renderer.element);
    this.renderer.setColorScale(this.colorScale);
    if (this.width > 0) this.renderer.resize(this.width, this.height, this.dpr);
  }

  private baseX() {
    return scaleLinear().domain(this.fullDomain).range([0, this.width]);
  }

  private updateZoomExtents(): void {
    const w = Math.max(1, this.width);
    const h = Math.max(1, this.height);
    const maxZoom = Math.max(1, (this.fullDomain[1] - this.fullDomain[0]) / this.minSpan);
    this.zoomBehavior
      .scaleExtent([1, maxZoom])
      .extent([
        [0, 0],
        [w, h],
      ])
      .translateExtent([
        [0, 0],
        [w, h],
      ]);
  }

  private draw(dirty: ReadonlySet<Layer>): void {
    // Nothing to draw before the first dataset; setData(null) clears explicitly.
    if (this.width <= 0 || this.height <= 0 || !this.series) return;
    const domain = this.domain;
    if (dirty.has('data')) this.drawData(domain);
    if (dirty.has('axes')) this.drawAxes(domain);
  }

  private drawData(domain: Domain): void {
    const started = performance.now();
    const { data, key, stale } = this.prepare(domain);
    if (data !== this.uploaded) {
      if (data.x.length > this.renderer.maxPoints) {
        this.skipped =
          `${this.renderer.kind.toUpperCase()} is capped at ${this.renderer.maxPoints.toLocaleString('en')} points ` +
          `(${data.x.length.toLocaleString('en')} requested)`;
        this.renderer.setData(EMPTY_LINES);
      } else {
        this.skipped = null;
        this.renderer.setData(data);
      }
      this.uploaded = data;
    }
    this.uploadedKey = key;
    const prepared = performance.now();
    const stats = this.renderer.render(this.viewport(domain));
    const rendered = performance.now();

    const report: FrameReport = {
      renderer: this.renderer.kind,
      decimation: this.decimation,
      totalPoints: this.series?.x.length ?? 0,
      uploadedPoints: this.skipped ? 0 : data.x.length,
      drawnPoints: stats.points,
      drawCalls: stats.drawCalls,
      prepareMs: prepared - started,
      renderMs: rendered - prepared,
      stale,
      skipped: this.skipped,
    };
    for (const listener of this.frameListeners) listener(report);
  }

  /** Decides what the renderer should hold for this frame (ADR 0006's zoom policy). */
  private prepare(domain: Domain): { data: LineSeriesData; key: string | null; stale: boolean } {
    const { series } = this;
    if (!series) return { data: EMPTY_LINES, key: null, stale: false };
    if (this.decimation === 'none') return { data: this.full, key: null, stale: false };

    const pixels = Math.max(1, Math.ceil(this.width * this.dpr));
    const key = `${this.decimation}|${String(pixels)}|${String(domain[0])}|${String(domain[1])}`;
    if (key === this.uploadedKey && this.uploaded)
      return { data: this.uploaded, key, stale: false };

    const canKeepStale = this.interacting && this.uploaded !== null;
    if (canKeepStale && visiblePointCount(series, domain[0], domain[1]) > this.liveBudget) {
      // Too big to redo inside a frame. Keep drawing the last decimation through the new view.
      return { data: this.uploaded ?? EMPTY_LINES, key: this.uploadedKey, stale: true };
    }
    const data = decimatedLines(series, this.decimation, domain[0], domain[1], pixels);
    return { data, key, stale: false };
  }

  private viewport(domain: Domain) {
    return {
      xDomain: domain,
      yDomain: [0, this.yTop()] as const,
      width: Math.max(1, this.width),
      height: Math.max(1, this.height),
      dpr: this.dpr,
    };
  }

  private yTop(): number {
    // A little headroom so the busiest station doesn't touch the top edge.
    return Math.max(1, Math.ceil(((this.series?.yMax ?? 1) * 1.05) / 5) * 5);
  }

  private drawAxes(domain: Domain): void {
    const left = this.dom.plot.offsetLeft;
    const top = this.dom.plot.offsetTop;
    const x = scaleUtc()
      .domain([new Date(toEpochMs(domain[0])), new Date(toEpochMs(domain[1]))])
      .range([0, this.width]);
    const y = scaleLinear().domain([0, this.yTop()]).range([this.height, 0]);
    const yTicks = Math.max(2, Math.floor(this.height / 45));

    select(this.dom.xAxis)
      .attr('transform', `translate(${String(left)},${String(top + this.height)})`)
      .call(axisBottom(x).ticks(Math.max(2, Math.floor(this.width / 110))));
    select(this.dom.yAxis)
      .attr('transform', `translate(${String(left)},${String(top)})`)
      .call(axisLeft(y).ticks(yTicks));
    select(this.dom.grid)
      .attr('transform', `translate(${String(left)},${String(top)})`)
      .call(
        axisLeft(y)
          .ticks(yTicks)
          .tickSize(-this.width)
          .tickFormat(() => ''),
      );
  }

  private emitView(): void {
    const domain = this.domain;
    for (const listener of this.viewListeners) listener(domain);
  }

  private watchDevicePixelRatio(): void {
    this.dprQuery?.removeEventListener('change', this.onDevicePixelRatioChange);
    this.dpr = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
    if (typeof matchMedia !== 'function') return;
    // The query matches only the current ratio, so it fires once when the ratio changes (e.g. the
    // window moves to another display). Then we re-arm it for the new ratio.
    this.dprQuery = matchMedia(`(resolution: ${String(this.dpr)}dppx)`);
    this.dprQuery.addEventListener('change', this.onDevicePixelRatioChange);
  }

  private readonly onDevicePixelRatioChange = (): void => {
    this.watchDevicePixelRatio();
    this.renderer.resize(this.width, this.height, this.dpr);
    this.uploadedKey = null;
    this.scheduler.invalidate('data');
  };
}
