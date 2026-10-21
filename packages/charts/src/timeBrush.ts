import { brushX, type BrushBehavior, type D3BrushEvent } from 'd3-brush';
import { select } from 'd3-selection';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Minutes since the epoch, half-open. */
export type TimeRange = readonly [number, number];

export interface TimeBrushScale {
  /** Plot pixels → minutes, for the current view. */
  readonly toTime: (px: number) => number;
  /** Minutes → plot pixels. */
  readonly toPx: (t: number) => number;
}

/**
 * The time series' x brush (T3.3, ADR 0015). `d3-brush` lives in an SVG inside the zoom overlay:
 * its filter takes only shift + drag, so a plain drag still reaches d3-zoom and pans. The
 * selection is kept in minutes, so it stays on the same moments through zoom, pan and resize;
 * putting it back in place has no source event and isn't reported.
 */
export class TimeBrush {
  private readonly svg: SVGSVGElement;
  private readonly group: SVGGElement;
  private readonly behavior: BrushBehavior<unknown>;
  private range: TimeRange | null = null;
  private enabled = false;

  constructor(
    overlay: HTMLElement,
    private readonly scale: () => TimeBrushScale,
    private readonly onChange: (range: TimeRange | null) => void,
  ) {
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('class', 'bp-chart__brush');
    this.group = document.createElementNS(SVG_NS, 'g');
    this.svg.append(this.group);
    overlay.append(this.svg);
    this.behavior = brushX<unknown>()
      .filter((event: MouseEvent) => this.enabled && event.shiftKey && !event.button)
      .on('brush end', (event: D3BrushEvent<unknown>) => {
        // Programmatic moves (placing the brush after a zoom) have no source event.
        if (!event.sourceEvent) return;
        const selection = event.selection as [number, number] | null;
        if (!selection) {
          this.range = null;
          this.onChange(null);
          return;
        }
        const { toTime } = this.scale();
        this.range = [toTime(selection[0]), toTime(selection[1])];
        this.onChange(this.range);
      });
  }

  get selection(): TimeRange | null {
    return this.range;
  }

  /** Off for data that can't be filtered (aggregate levels, ADR 0015); turning off clears it. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.svg.classList.toggle('bp-chart__brush--off', !enabled);
    if (!enabled) this.set(null);
  }

  /** Sets the selection without reporting it, e.g. "clear filters". */
  set(range: TimeRange | null): void {
    this.range = range;
    this.place();
  }

  /** New plot size: the brushable area, then the selection, follow it. */
  resize(width: number, height: number): void {
    this.behavior.extent([
      [0, 0],
      [Math.max(1, width), Math.max(1, height)],
    ]);
    select(this.group).call(this.behavior);
    this.place();
  }

  /** Puts the selection where its minutes are in the current view. */
  place(): void {
    const group = select(this.group);
    if (!this.range) {
      this.behavior.move(group, null);
      return;
    }
    const { toPx } = this.scale();
    this.behavior.move(group, [toPx(this.range[0]), toPx(this.range[1])]);
  }

  destroy(): void {
    select(this.group).on('.brush', null);
    this.svg.remove();
  }
}
