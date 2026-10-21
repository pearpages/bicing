import { resizeCanvas } from '@bicing/renderers';
import { axisBottom, axisLeft } from 'd3-axis';
import { brushX, type BrushBehavior, type D3BrushEvent } from 'd3-brush';
import { scaleBand, scaleLinear } from 'd3-scale';
import { select } from 'd3-selection';
import { FrameScheduler, type FrameClock } from './scheduler';

/** Bins [lo, hi): what a histogram brush selects. */
export type BinRange = readonly [number, number];

/** The few canvas calls the bars need; a test can pass its own. */
export interface BarCanvas {
  fillStyle: string | CanvasGradient | CanvasPattern;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
}

export interface HistogramOptions {
  readonly bins: number;
  /** The chart's accessible name. */
  readonly label: string;
  /** A bin's axis label, e.g. "7" for an hour or "35%" for occupancy. */
  readonly tick: (bin: number) => string;
  /** Label every n-th bin, so 24 hours don't crowd the axis. */
  readonly tickEvery?: number;
  readonly formatNumber?: (n: number) => string;
  /** For tests, which have no canvas. Defaults to the canvas's 2D context. */
  readonly context?: BarCanvas;
  readonly clock?: FrameClock;
}

export interface Bar {
  readonly x: number;
  readonly width: number;
  /** Heights from the bottom, in CSS pixels. */
  readonly total: number;
  readonly passing: number;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** A few dozen bins at most, so a spread is fine. */
const maxOf = (values: ArrayLike<number>) => Math.max(0, ...Array.from(values));

/**
 * Bar geometry for a plot of `width` × `height`: one band per bin, scaled to the largest total,
 * so the faint total bars stay put while the passing bars move with the filters.
 */
export function histogramBars(
  total: ArrayLike<number>,
  passing: ArrayLike<number>,
  width: number,
  height: number,
): Bar[] {
  const bins = Array.from({ length: total.length }, (_, b) => b);
  const x = scaleBand<number>().domain(bins).range([0, width]).padding(0.15);
  const y = scaleLinear()
    .domain([0, Math.max(1, maxOf(total))])
    .range([0, height]);
  return bins.map((b) => ({
    x: x(b) ?? 0,
    width: x.bandwidth(),
    total: y(total[b] as number),
    passing: y(Math.min(passing[b] as number, total[b] as number)),
  }));
}

/**
 * A histogram over a few bins (T3.3, ADR 0015): D3 scales and axes, bars on a Canvas 2D, and an x
 * brush that selects whole bins. Framework-agnostic and driven through methods (P11).
 */
export class HistogramChart {
  private readonly root: HTMLDivElement;
  private readonly plot: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: BarCanvas | null;
  private readonly xAxis: SVGGElement;
  private readonly yAxis: SVGGElement;
  private readonly brushGroup: SVGGElement;
  private readonly brush: BrushBehavior<unknown>;
  private readonly scheduler: FrameScheduler<'bars'>;
  private readonly resizeObserver: ResizeObserver | null;
  private readonly listeners = new Set<(range: BinRange | null) => void>();
  private total: ArrayLike<number>;
  private passing: ArrayLike<number>;
  private selection: BinRange | null = null;
  private width = 0;
  private height = 0;
  private tick: (bin: number) => string;
  private formatNumber: (n: number) => string;

  constructor(
    host: HTMLElement,
    private readonly options: HistogramOptions,
  ) {
    this.tick = options.tick;
    this.formatNumber = options.formatNumber ?? String;
    this.total = new Uint32Array(options.bins);
    this.passing = this.total;
    this.root = document.createElement('div');
    this.root.className = 'bp-histogram';
    this.root.setAttribute('role', 'img');
    this.root.setAttribute('aria-label', options.label);
    this.plot = document.createElement('div');
    this.plot.className = 'bp-histogram__plot';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'bp-histogram__bars';
    this.plot.append(this.canvas);

    const axes = document.createElementNS(SVG_NS, 'svg');
    axes.setAttribute('class', 'bp-histogram__axes');
    this.xAxis = document.createElementNS(SVG_NS, 'g');
    this.xAxis.setAttribute('class', 'bp-chart__axis');
    this.yAxis = document.createElementNS(SVG_NS, 'g');
    this.yAxis.setAttribute('class', 'bp-chart__axis');
    axes.append(this.xAxis, this.yAxis);

    const overlay = document.createElementNS(SVG_NS, 'svg');
    overlay.setAttribute('class', 'bp-histogram__brush');
    this.brushGroup = document.createElementNS(SVG_NS, 'g');
    overlay.append(this.brushGroup);
    this.plot.append(overlay);
    this.root.append(this.plot, axes);
    host.append(this.root);
    this.context = options.context ?? this.canvas.getContext('2d');

    this.brush = brushX<unknown>().on('brush end', (event: D3BrushEvent<unknown>) => {
      // Snapping the selection to bin edges is a programmatic move: not reported again.
      if (!event.sourceEvent) return;
      const pixels = event.selection as [number, number] | null;
      const range = pixels ? this.binsAt(pixels) : null;
      if (range?.[0] !== this.selection?.[0] || range?.[1] !== this.selection?.[1]) {
        this.selection = range;
        for (const listener of this.listeners) listener(range);
      }
      if (event.type === 'end') this.placeBrush();
    });
    // Attached now, not at the first resize, so setBrush works before the chart has a size.
    this.brush.extent([
      [0, 0],
      [1, 1],
    ]);
    select(this.brushGroup).call(this.brush);

    this.scheduler = new FrameScheduler<'bars'>(() => {
      this.draw();
    }, options.clock);
    this.resizeObserver =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver((entries) => {
            const box = entries[0]?.contentRect;
            if (box) this.resize(box.width, box.height);
          })
        : null;
    this.resizeObserver?.observe(this.plot);
  }

  /** `total` per bin with no filter, and what passes every filter except this histogram's own. */
  setCounts(total: ArrayLike<number>, passing: ArrayLike<number>): void {
    this.total = total;
    this.passing = passing;
    this.scheduler.invalidate('bars');
  }

  setLabel(label: string): void {
    this.root.setAttribute('aria-label', label);
  }

  /** New wording for the axes, e.g. another language (P27). */
  setFormat(tick: (bin: number) => string, formatNumber: (n: number) => string = String): void {
    this.tick = tick;
    this.formatNumber = formatNumber;
    this.scheduler.invalidate('bars');
  }

  /** Sets the brush without reporting it (e.g. "clear filters"). */
  setBrush(range: BinRange | null): void {
    this.selection = range;
    this.placeBrush();
  }

  get brushRange(): BinRange | null {
    return this.selection;
  }

  /** User brushing only, in whole bins: live while dragging, null when it's cleared. */
  onBrush(listener: (range: BinRange | null) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Resizes to the plot box. Called by the ResizeObserver; public for environments without one. */
  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    resizeCanvas(this.canvas, width, height, this.dpr());
    this.brush.extent([
      [0, 0],
      [Math.max(1, width), Math.max(1, height)],
    ]);
    select(this.brushGroup).call(this.brush);
    this.placeBrush();
    this.scheduler.invalidate('bars');
    this.scheduler.flush();
  }

  destroy(): void {
    this.scheduler.destroy();
    this.resizeObserver?.disconnect();
    select(this.brushGroup).on('.brush', null);
    this.root.remove();
    this.listeners.clear();
  }

  private dpr(): number {
    return typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
  }

  private step(): number {
    return this.width / Math.max(1, this.options.bins);
  }

  /** Pixels → whole bins: every bin the selection touches. */
  private binsAt([x0, x1]: readonly [number, number]): BinRange | null {
    const step = this.step();
    const lo = Math.max(0, Math.floor(x0 / step));
    const hi = Math.min(this.options.bins, Math.ceil(x1 / step));
    return hi > lo ? [lo, hi] : null;
  }

  private placeBrush(): void {
    const group = select(this.brushGroup);
    const range = this.selection;
    const step = this.step();
    this.brush.move(group, range ? [range[0] * step, range[1] * step] : null);
  }

  private draw(): void {
    const { context: ctx, width, height } = this;
    if (width <= 0 || height <= 0) return;
    const bars = histogramBars(this.total, this.passing, width, height);
    if (ctx) {
      const style = getComputedStyle(this.root);
      const color = (name: string, fallback: string) =>
        style.getPropertyValue(name).trim() || fallback;
      const dpr = this.dpr();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = color('--bp-histogram-total', 'rgb(128 128 128 / 0.25)');
      for (const bar of bars) ctx.fillRect(bar.x, height - bar.total, bar.width, bar.total);
      ctx.fillStyle = color('--bp-histogram-passing', '#2a78d6');
      for (const bar of bars) ctx.fillRect(bar.x, height - bar.passing, bar.width, bar.passing);
    }
    this.drawAxes();
  }

  private drawAxes(): void {
    const { width, height, options } = this;
    const left = this.plot.offsetLeft;
    const top = this.plot.offsetTop;
    const bins = Array.from({ length: options.bins }, (_, b) => b);
    const every = options.tickEvery ?? 1;
    const x = scaleBand<number>().domain(bins).range([0, width]).padding(0.15);
    const y = scaleLinear()
      .domain([0, Math.max(1, maxOf(this.total))])
      .range([height, 0]);
    select(this.xAxis)
      .attr('transform', `translate(${String(left)},${String(top + height)})`)
      .call(
        axisBottom(x)
          .tickValues(bins.filter((b) => b % every === 0))
          .tickFormat((b) => this.tick(b)),
      );
    const format = this.formatNumber;
    select(this.yAxis)
      .attr('transform', `translate(${String(left)},${String(top)})`)
      .call(
        axisLeft(y)
          .ticks(3)
          .tickFormat((n) => format(n.valueOf())),
      );
  }
}
