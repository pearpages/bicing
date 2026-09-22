import { resizeCanvas } from '../dpr';
import { visibleRange, lineCount } from '../lines';
import { groupLinesByBucket, samplePalette } from '../palette';
import { projectionFor } from '../projection';
import {
  EMPTY_LINES,
  type LineSeriesData,
  type Renderer,
  type RenderStats,
  type Viewport,
} from '../types';

export interface CanvasRendererOptions {
  /** For tests and for reusing an existing element. */
  readonly canvas?: HTMLCanvasElement;
  readonly className?: string;
  readonly lineWidth?: number;
  /** Many overlapping lines: partial transparency keeps density readable. */
  readonly alpha?: number;
}

/**
 * Canvas 2D polylines. The per-frame cost is O(visible points) of JS projection plus one stroke()
 * per palette color, so it needs decimated input to stay smooth past a few hundred thousand points.
 */
export class CanvasRenderer implements Renderer {
  readonly kind = 'canvas';
  readonly element: HTMLCanvasElement;
  // Limited by memory, not correctness. Staying smooth is the decimator's job.
  readonly maxPoints = 50_000_000;

  private readonly ctx: CanvasRenderingContext2D;
  private readonly lineWidth: number;
  private readonly alpha: number;
  private data: LineSeriesData = EMPTY_LINES;
  private groups: Uint32Array[] = [];
  private palette: string[] = samplePalette(() => '#4c78a8');
  private cssWidth = 1;
  private cssHeight = 1;
  private dpr = 1;

  constructor(options: CanvasRendererOptions = {}) {
    this.element = options.canvas ?? document.createElement('canvas');
    if (options.className) this.element.classList.add(options.className);
    const ctx = this.element.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
    this.lineWidth = options.lineWidth ?? 1;
    this.alpha = options.alpha ?? 0.6;
  }

  setData(data: LineSeriesData): void {
    if (data.x.length > this.maxPoints) {
      throw new RangeError(`CanvasRenderer accepts at most ${String(this.maxPoints)} points`);
    }
    this.data = data;
    this.groups = groupLinesByBucket(data.lineValue, this.palette.length);
  }

  setColorScale(interpolate: (t: number) => string): void {
    this.palette = samplePalette(interpolate);
    this.groups = groupLinesByBucket(this.data.lineValue, this.palette.length);
  }

  resize(width: number, height: number, dpr: number): void {
    this.cssWidth = width;
    this.cssHeight = height;
    this.dpr = dpr;
    resizeCanvas(this.element, width, height, dpr);
  }

  render(view: Viewport): RenderStats {
    const { ctx, data } = this;
    const { kx, bx, ky, by } = projectionFor(view);
    const [x0, x1] = view.xDomain;

    // Draw in CSS pixels; the dpr scale maps them onto the backing store.
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);
    ctx.lineWidth = this.lineWidth;
    ctx.globalAlpha = this.alpha;
    ctx.lineJoin = 'round';

    let points = 0;
    let drawCalls = 0;
    const x = data.x;
    const y = data.y;
    for (let b = 0; b < this.groups.length; b++) {
      const group = this.groups[b] as Uint32Array;
      if (group.length === 0) continue;
      ctx.beginPath();
      let any = false;
      for (const line of group) {
        const { start, end } = visibleRange(data, line, x0, x1);
        if (end <= start) continue;
        any = true;
        const px = (x[start] as number) * kx + bx;
        const py = (y[start] as number) * ky + by;
        ctx.moveTo(px, py);
        // An isolated sample between gaps would otherwise be invisible.
        if (end - start === 1) ctx.lineTo(px + 1, py);
        for (let i = start + 1; i < end; i++) {
          ctx.lineTo((x[i] as number) * kx + bx, (y[i] as number) * ky + by);
        }
        points += end - start;
      }
      if (!any) continue;
      ctx.strokeStyle = this.palette[b] ?? '#000';
      ctx.stroke();
      drawCalls++;
    }
    ctx.globalAlpha = 1;
    return { points, drawCalls };
  }

  destroy(): void {
    this.data = EMPTY_LINES;
    this.groups = [];
    this.element.remove();
  }

  /** Exposed for the benchmark overlay. */
  get lineCount(): number {
    return lineCount(this.data);
  }
}
