import { lineCount } from '../lines';
import { projectionFor } from '../projection';
import {
  EMPTY_LINES,
  type LineSeriesData,
  type Renderer,
  type RenderStats,
  type Viewport,
} from '../types';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface SvgRendererOptions {
  readonly className?: string;
  readonly lineWidth?: number;
  readonly alpha?: number;
}

/**
 * The deliberately naive baseline (ADR 0001): one <path> per line, and the `d` string is rebuilt for every
 * point on every frame, with no culling. That's what a typical D3 line chart does
 * (`selection.attr('d', line)`), so the benchmark measures the real-world approach, not a
 * straw man. Capped at 1M points: beyond that a single frame takes seconds and the tab stops
 * responding, which makes it unmeasurable rather than slow.
 */
export class SvgRenderer implements Renderer {
  readonly kind = 'svg';
  readonly element: SVGSVGElement;
  readonly maxPoints = 1_000_000;

  private readonly lineWidth: number;
  private readonly alpha: number;
  private data: LineSeriesData = EMPTY_LINES;
  private paths: SVGPathElement[] = [];
  private interpolate: (t: number) => string = () => '#4c78a8';

  constructor(options: SvgRendererOptions = {}) {
    this.element = document.createElementNS(SVG_NS, 'svg');
    if (options.className) this.element.classList.add(options.className);
    this.lineWidth = options.lineWidth ?? 1;
    this.alpha = options.alpha ?? 0.6;
  }

  setData(data: LineSeriesData): void {
    if (data.x.length > this.maxPoints) {
      throw new RangeError(`SvgRenderer accepts at most ${String(this.maxPoints)} points`);
    }
    this.data = data;
    for (const path of this.paths) path.remove();
    this.paths = [];
    const count = lineCount(data);
    for (let k = 0; k < count; k++) {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke-width', String(this.lineWidth));
      path.setAttribute('stroke-opacity', String(this.alpha));
      path.setAttribute('stroke-linejoin', 'round');
      this.element.append(path);
      this.paths.push(path);
    }
    this.applyColors();
  }

  setColorScale(interpolate: (t: number) => string): void {
    this.interpolate = interpolate;
    this.applyColors();
  }

  resize(width: number, height: number): void {
    this.element.setAttribute('width', String(width));
    this.element.setAttribute('height', String(height));
  }

  render(view: Viewport): RenderStats {
    const { data } = this;
    const { kx, bx, ky, by } = projectionFor(view);
    for (let k = 0; k < this.paths.length; k++) {
      const start = data.lineStarts[k] as number;
      const end = data.lineStarts[k + 1] as number;
      let d = '';
      for (let i = start; i < end; i++) {
        const px = (data.x[i] as number) * kx + bx;
        const py = (data.y[i] as number) * ky + by;
        d += `${i === start ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`;
      }
      if (end - start === 1) d += 'h1';
      this.paths[k]?.setAttribute('d', d);
    }
    return { points: data.x.length, drawCalls: this.paths.length };
  }

  destroy(): void {
    this.paths = [];
    this.data = EMPTY_LINES;
    this.element.remove();
  }

  private applyColors(): void {
    for (let k = 0; k < this.paths.length; k++) {
      this.paths[k]?.setAttribute('stroke', this.interpolate(this.data.lineValue[k] ?? 0));
    }
  }
}
