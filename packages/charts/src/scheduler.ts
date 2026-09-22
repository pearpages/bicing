/** requestAnimationFrame behind an interface, so tests can drive frames by hand. */
export interface FrameClock {
  request(callback: (time: number) => void): number;
  cancel(handle: number): void;
}

export const animationFrameClock: FrameClock = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => {
    cancelAnimationFrame(handle);
  },
};

/**
 * Coalesces invalidations into at most one draw per frame (P7). A zoom gesture can fire several
 * events between two frames; each only marks layers dirty, and the draw callback runs once
 * with the union. Layers that weren't invalidated aren't redrawn.
 */
export class FrameScheduler<Layer extends string> {
  private readonly dirty = new Set<Layer>();
  private handle: number | null = null;
  private destroyed = false;

  constructor(
    private readonly draw: (dirty: ReadonlySet<Layer>, time: number) => void,
    private readonly clock: FrameClock = animationFrameClock,
  ) {}

  invalidate(...layers: Layer[]): void {
    if (this.destroyed) return;
    for (const layer of layers) this.dirty.add(layer);
    if (this.handle === null && this.dirty.size > 0) {
      this.handle = this.clock.request((time) => {
        this.handle = null;
        this.run(time);
      });
    }
  }

  /** Draws pending layers now (e.g. right after a resize, to avoid one blank frame). */
  flush(time = performance.now()): void {
    if (this.handle !== null) {
      this.clock.cancel(this.handle);
      this.handle = null;
    }
    this.run(time);
  }

  get isPending(): boolean {
    return this.handle !== null;
  }

  destroy(): void {
    this.destroyed = true;
    if (this.handle !== null) this.clock.cancel(this.handle);
    this.handle = null;
    this.dirty.clear();
  }

  private run(time: number): void {
    if (this.dirty.size === 0 || this.destroyed) return;
    // Snapshot and clear *before* drawing: invalidations made during the draw schedule the next
    // frame instead of being lost, and a throwing draw can't wedge the scheduler.
    const layers = new Set(this.dirty);
    this.dirty.clear();
    this.draw(layers, time);
  }
}
