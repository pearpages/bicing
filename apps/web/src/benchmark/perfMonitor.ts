import { percentile, Ring } from './stats';

/** Frames slower than this are "long" (the RAIL / Long Animation Frames threshold). */
export const LONG_FRAME_MS = 50;
export const FRAME_BUDGET_MS = 1000 / 60;

export interface PerfSnapshot {
  /** Frames presented in the last second. */
  readonly fps: number;
  /** Frame-to-frame time percentiles over the recent window, in ms. */
  readonly p50: number;
  readonly p95: number;
  readonly worst: number;
  /** The recent frame times, oldest first, for the trace. */
  readonly trace: Float64Array;
  /** Long animation frames (≥ 50 ms) since the last reset, and the longest one. */
  readonly longFrames: number;
  readonly longestFrame: number;
  readonly memoryMb: number | null;
  /** 'page' = measureUserAgentSpecificMemory (needs cross-origin isolation); 'heap' = Chrome's JS heap size. */
  readonly memorySource: 'page' | 'heap' | null;
}

interface MemoryMeasurement {
  bytes: number;
}
type MeasureMemory = () => Promise<MemoryMeasurement>;
interface ChromeMemory {
  usedJSHeapSize: number;
}

/**
 * Measures what users feel: frame-to-frame time from requestAnimationFrame. A draw that takes
 * 80 ms delays the next rAF by 80 ms, whatever the renderer. Long frames come from the Long
 * Animation Frames API (falling back to Long Tasks). Framework-free, so the numbers aren't
 * affected by how the UI shows them.
 */
export class PerfMonitor {
  private readonly frames = new Ring(180);
  private readonly lastSecond = new Ring(240);
  private lastTime: number | null = null;
  private handle: number | null = null;
  private observer: PerformanceObserver | null = null;
  private memoryTimer: ReturnType<typeof setInterval> | null = null;
  private longFrames = 0;
  private longestFrame = 0;
  private memoryMb: number | null = null;
  private memorySource: PerfSnapshot['memorySource'] = null;

  start(): void {
    if (this.handle !== null) return;
    const tick = (time: number) => {
      if (this.lastTime !== null) {
        this.frames.push(time - this.lastTime);
        this.lastSecond.push(time);
      }
      this.lastTime = time;
      this.handle = requestAnimationFrame(tick);
    };
    this.handle = requestAnimationFrame(tick);
    this.observeLongFrames();
    void this.sampleMemory();
    this.memoryTimer = setInterval(() => void this.sampleMemory(), 5_000);
  }

  stop(): void {
    if (this.handle !== null) cancelAnimationFrame(this.handle);
    this.handle = null;
    this.lastTime = null;
    this.observer?.disconnect();
    this.observer = null;
    if (this.memoryTimer !== null) clearInterval(this.memoryTimer);
    this.memoryTimer = null;
  }

  /** Starts a fresh measurement window (e.g. at the beginning of a scripted run). */
  reset(): void {
    this.frames.clear();
    this.lastSecond.clear();
    this.lastTime = null;
    this.longFrames = 0;
    this.longestFrame = 0;
  }

  snapshot(): PerfSnapshot {
    const trace = this.frames.toArray();
    const stamps = this.lastSecond.toArray();
    const newest = stamps[stamps.length - 1] ?? 0;
    let fps = 0;
    for (let i = stamps.length - 1; i >= 0 && newest - (stamps[i] ?? 0) <= 1_000; i--) fps++;
    return {
      fps,
      p50: percentile(trace, 50),
      p95: percentile(trace, 95),
      worst: trace.length === 0 ? 0 : Math.max(...trace),
      trace,
      longFrames: this.longFrames,
      longestFrame: this.longestFrame,
      memoryMb: this.memoryMb,
      memorySource: this.memorySource,
    };
  }

  private observeLongFrames(): void {
    const supported = PerformanceObserver.supportedEntryTypes;
    const type = supported.includes('long-animation-frame')
      ? 'long-animation-frame'
      : supported.includes('longtask')
        ? 'longtask'
        : null;
    if (!type) return;
    this.observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration < LONG_FRAME_MS) continue;
        this.longFrames++;
        this.longestFrame = Math.max(this.longestFrame, entry.duration);
      }
    });
    this.observer.observe({ type, buffered: false });
  }

  private async sampleMemory(): Promise<void> {
    const measure = (
      performance as Performance & { measureUserAgentSpecificMemory?: MeasureMemory }
    ).measureUserAgentSpecificMemory;
    if (globalThis.crossOriginIsolated && measure) {
      try {
        // Covers the page and its workers, but not GPU buffers (not exposed to the web).
        const result = await measure.call(performance);
        this.memoryMb = result.bytes / 1e6;
        this.memorySource = 'page';
        return;
      } catch {
        // Fall through to the heap estimate (e.g. the API is unavailable in this context).
      }
    }
    const heap = (performance as Performance & { memory?: ChromeMemory }).memory;
    if (heap) {
      this.memoryMb = heap.usedJSHeapSize / 1e6;
      this.memorySource = 'heap';
    }
  }
}
