import { toEpochMs, type StationSeries } from '@bicing/core';
import {
  EMPTY_LINES,
  type LineSeriesData,
  type Renderer,
  type RendererKind,
} from '@bicing/renderers';
import { axisBottom, axisLeft } from 'd3-axis';
import { scaleLinear, scaleUtc } from 'd3-scale';
import { pointer, select } from 'd3-selection';
import {
  zoom,
  zoomIdentity,
  type D3ZoomEvent,
  type ZoomBehavior,
  type ZoomTransform,
} from 'd3-zoom';
import { drawGaps, gapAt, gapLines, MIN_HOVER_PX, sortGaps, type GapPeriod } from './gaps';
import { createChartDom, type ChartDom } from './layers';
import { TimeBrush, type TimeRange } from './timeBrush';
import { placeTooltip } from './tooltip';
import { chartFormat, type ChartFormat, type ChartLocale } from './locale';
import { pickAt, type Hit } from './picking';
import { decimatedLines, fullLines, visiblePointCount, type Decimation } from './lines';
import { FrameScheduler, type FrameClock } from './scheduler';

type Layer = 'data' | 'axes' | 'overlay';

/** How far (in CSS px) the pointer may be from a line and still pick it. */
const PICK_RADIUS_PX = 24;
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
  readonly locale: ChartLocale;
  /**
   * Tooltip lines for a hovered sample. The app knows station names; the chart only knows indices.
   * `format` follows the active locale, so the app's lines switch language with the axes.
   */
  readonly describe?: (hit: Hit, format: ChartFormat) => readonly string[];
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
  private readonly hoverListeners = new Set<Listener<Hit | null>>();
  private readonly brushListeners = new Set<Listener<TimeRange | null>>();
  private readonly brush: TimeBrush;
  private readonly describe: ((hit: Hit, format: ChartFormat) => readonly string[]) | null;
  private pointerAt: readonly [number, number] | null = null;
  private gaps: readonly GapPeriod[] = [];
  private hit: Hit | null = null;

  private renderer: Renderer;
  private decimation: Decimation;
  private colorScale: (t: number) => string;
  private locale: ChartLocale;
  private format: ChartFormat;
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
  /** Set while the renderer refuses the data; the message is worded per frame, in the active locale. */
  private capped: { readonly max: number; readonly requested: number } | null = null;
  private interacting = false;

  constructor(host: HTMLElement, options: TimeSeriesChartOptions) {
    this.locale = options.locale;
    this.format = chartFormat(options.locale);
    this.dom = createChartDom(host, options.locale.label);
    this.renderer = options.renderer;
    this.decimation = options.decimation ?? 'none';
    this.colorScale = options.colorScale ?? (() => 'rgb(42, 120, 214)');
    this.minSpan = options.minSpanMinutes ?? 30;
    this.liveBudget = options.liveDecimationBudget ?? LIVE_DECIMATION_BUDGET;
    this.describe = options.describe ?? null;
    this.scheduler = new FrameScheduler<Layer>((dirty) => {
      this.draw(dirty);
    }, options.clock);

    this.mountRenderer();

    this.zoomBehavior = zoom<HTMLDivElement, unknown>()
      .scaleExtent([1, 1])
      // d3-zoom's default filter, minus shift + drag, which belongs to the time brush (T3.3).
      .filter(
        (event: MouseEvent) =>
          (!event.ctrlKey || event.type === 'wheel') &&
          !event.button &&
          !(event.shiftKey && event.type !== 'wheel'),
      )
      .on('start', (event: D3ZoomEvent<HTMLDivElement, unknown>) => {
        // Programmatic zooms have no sourceEvent; only real gestures switch to the live policy.
        if (event.sourceEvent) this.interacting = true;
      })
      .on('zoom', (event: D3ZoomEvent<HTMLDivElement, unknown>) => {
        this.transform = event.transform;
        this.scheduler.invalidate('data', 'axes', 'overlay');
        this.emitView();
      })
      .on('end', (event: D3ZoomEvent<HTMLDivElement, unknown>) => {
        if (event.sourceEvent) this.setInteracting(false);
      });
    this.brush = new TimeBrush(
      this.dom.overlay,
      () => {
        const [d0, d1] = this.domain;
        const scale = (d1 - d0) / Math.max(1, this.width);
        return { toTime: (px) => d0 + px * scale, toPx: (t) => (t - d0) / scale };
      },
      (range) => {
        for (const listener of this.brushListeners) listener(range);
      },
    );
    select(this.dom.overlay)
      .call(this.zoomBehavior)
      .on('pointermove.hover', (event: PointerEvent) => {
        this.pointerAt = pointer(event, this.dom.overlay);
        this.scheduler.invalidate('overlay');
      })
      .on('pointerleave.hover', () => {
        this.pointerAt = null;
        this.scheduler.invalidate('overlay');
      });

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

  /**
   * New dataset. By default the zoom resets to the data's extent. A whole-history view (T2.5b)
   * passes the coverage as `extent`, so the zoom limits don't depend on the window loaded, and
   * `keepView` to swap levels without moving the view.
   */
  setData(
    series: StationSeries | null,
    options: { readonly extent?: Domain; readonly keepView?: boolean } = {},
  ): void {
    const keep = options.keepView && this.width > 0 && this.series ? this.domain : null;
    this.series = series;
    this.full = series ? fullLines(series) : EMPTY_LINES;
    this.fullDomain =
      options.extent ?? (series && series.xMax > series.xMin ? [series.xMin, series.xMax] : [0, 1]);
    this.uploaded = null;
    this.uploadedKey = null;
    if (!series) {
      this.renderer.setData(EMPTY_LINES);
      this.renderer.render(this.viewport(this.fullDomain));
      for (const g of [this.dom.xAxis, this.dom.yAxis, this.dom.grid]) g.replaceChildren();
    }
    this.updateZoomExtents();
    if (keep) this.zoomTo(keep);
    else this.zoomBehavior.transform(select(this.dom.overlay), zoomIdentity);
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

  /** Feed-wide silences to shade and explain (T2.6). Independent of the data loaded. */
  setGaps(gaps: readonly GapPeriod[]): void {
    this.gaps = sortGaps(gaps);
    this.scheduler.invalidate('axes', 'overlay');
  }

  /** Swaps the language of the axes, tooltip and messages. The data isn't touched. */
  setLocale(locale: ChartLocale): void {
    this.locale = locale;
    this.format = chartFormat(locale);
    this.dom.root.setAttribute('aria-label', locale.label);
    this.scheduler.invalidate('axes', 'overlay');
    // Only to re-word the cap message in the frame report; `prepare` keeps the upload.
    if (this.capped) this.scheduler.invalidate('data');
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

  /** The picked sample under the pointer, or null. Fires only when it changes. */
  onHover(listener: Listener<Hit | null>): () => void {
    this.hoverListeners.add(listener);
    return () => this.hoverListeners.delete(listener);
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
    this.brush.resize(width, height);
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
    this.hoverListeners.clear();
    this.brushListeners.clear();
    this.brush.destroy();
  }

  /**
   * The time brush (T3.3): shift + drag selects a range of minutes. Off by default; the app turns
   * it on for data it can filter (ADR 0015), and turning it off clears the selection.
   */
  setBrushEnabled(enabled: boolean): void {
    this.brush.setEnabled(enabled);
  }

  /** Sets the brush without reporting it (e.g. "clear filters"). */
  setBrush(range: TimeRange | null): void {
    this.brush.set(range);
  }

  get brushRange(): TimeRange | null {
    return this.brush.selection;
  }

  /** User brushing only: live while dragging, then at the end; null when it's cleared. */
  onBrush(listener: Listener<TimeRange | null>): () => void {
    this.brushListeners.add(listener);
    return () => this.brushListeners.delete(listener);
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
    if (dirty.has('overlay')) this.drawHover(domain);
  }

  private drawHover(domain: Domain): void {
    const { hover } = this.dom;
    const { series, pointerAt } = this;
    // Hover is off during gestures: the tooltip would jitter, and panning is the user's focus.
    const active = pointerAt !== null && !this.interacting;
    const pointerT = pointerAt
      ? domain[0] + (pointerAt[0] / this.width) * (domain[1] - domain[0])
      : 0;
    // Inside a gap there's no reading to pick; the tooltip explains the gap instead.
    const inside = active ? gapAt(this.gaps, pointerT) : null;
    const pxPerMinute = this.width / (domain[1] - domain[0]);
    const gap = inside && (inside.t1 - inside.t0) * pxPerMinute >= MIN_HOVER_PX ? inside : null;
    const hit =
      series && pointerAt && active && !gap
        ? pickAt(
            series,
            pointerT,
            ((this.height - pointerAt[1]) / this.height) * this.yTop(),
            (PICK_RADIUS_PX / this.height) * this.yTop(),
          )
        : null;
    if (hit?.index !== this.hit?.index) {
      this.hit = hit;
      for (const listener of this.hoverListeners) listener(hit);
    }
    if (gap && pointerAt) {
      hover.marker.setAttribute('visibility', 'hidden');
      this.showTooltip(gapLines(gap, this.format, this.locale), pointerAt[0], pointerAt[1]);
      return;
    }
    if (!hit || !pointerAt) {
      hover.group.setAttribute('visibility', 'hidden');
      return;
    }

    const px = ((hit.t - domain[0]) / (domain[1] - domain[0])) * this.width;
    const py = this.height - (hit.y / this.yTop()) * this.height;
    hover.marker.setAttribute('visibility', 'inherit');
    setAttributes(hover.marker, { cx: px, cy: py });
    hover.marker.setAttribute('fill', this.colorScale(series?.meanFill[hit.station] ?? 0));
    const lines = this.describe
      ? this.describe(hit, this.format)
      : [this.locale.station(hit.station + 1), this.format.time(hit.t), this.locale.bikes(hit.y)];
    this.showTooltip(lines, px, py);
  }

  /** The crosshair at `px` and a tooltip beside (`px`, `py`), in plot coordinates. */
  private showTooltip(lines: readonly string[], px: number, py: number): void {
    const { hover } = this.dom;
    const left = this.dom.plot.offsetLeft;
    const top = this.dom.plot.offsetTop;
    hover.group.setAttribute('visibility', 'visible');
    hover.group.setAttribute('transform', `translate(${String(left)},${String(top)})`);
    setAttributes(hover.crosshair, { x1: px, x2: px, y1: 0, y2: this.height });
    placeTooltip(
      { tooltip: hover.tooltip, box: hover.tooltipBox, text: hover.tooltipText },
      lines,
      px,
      py,
      this.width,
      this.height,
    );
  }

  private drawData(domain: Domain): void {
    const started = performance.now();
    const { data, key, stale } = this.prepare(domain);
    if (data !== this.uploaded) {
      if (data.x.length > this.renderer.maxPoints) {
        this.capped = { max: this.renderer.maxPoints, requested: data.x.length };
        this.renderer.setData(EMPTY_LINES);
      } else {
        this.capped = null;
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
      uploadedPoints: this.capped ? 0 : data.x.length,
      drawnPoints: stats.points,
      drawCalls: stats.drawCalls,
      prepareMs: prepared - started,
      renderMs: rendered - prepared,
      stale,
      skipped: this.capped
        ? this.locale.capped(
            this.renderer.kind.toUpperCase(),
            this.format.number(this.capped.max),
            this.format.number(this.capped.requested),
          )
        : null,
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
    // The brush is kept in minutes; the axes redraw on every view change, so it moves with them.
    this.brush.place();
    const left = this.dom.plot.offsetLeft;
    const top = this.dom.plot.offsetTop;
    const x = scaleUtc()
      .domain([new Date(toEpochMs(domain[0])), new Date(toEpochMs(domain[1]))])
      .range([0, this.width]);
    const y = scaleLinear().domain([0, this.yTop()]).range([this.height, 0]);
    const yTicks = Math.max(2, Math.floor(this.height / 45));

    select(this.dom.xAxis)
      .attr('transform', `translate(${String(left)},${String(top + this.height)})`)
      .call(
        axisBottom(x)
          .ticks(Math.max(2, Math.floor(this.width / 110)))
          // d3-axis types the tick as Date | NumberValue, but a UTC scale only produces Dates.
          .tickFormat((d) => this.format.tick(d instanceof Date ? d : new Date(d.valueOf()))),
      );
    select(this.dom.yAxis)
      .attr('transform', `translate(${String(left)},${String(top)})`)
      .call(
        axisLeft(y)
          .ticks(yTicks)
          .tickFormat((n) => this.format.number(n.valueOf())),
      );
    this.dom.gaps.setAttribute('transform', `translate(${String(left)},${String(top)})`);
    drawGaps(this.dom.gaps, this.gaps, domain, this.width, this.height);
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

function setAttributes(element: Element, attributes: Record<string, number>): void {
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
}
