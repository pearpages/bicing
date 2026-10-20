import type { FrameReport, TimeSeriesChart } from '@bicing/charts';
import type { PerfMonitor } from './perfMonitor';
import { SCENARIO_MS, scenarioDomain } from './scenario';
import { percentile } from './stats';

export interface ScenarioMeasurement {
  readonly frames: number;
  readonly durationMs: number;
  readonly fps: number;
  readonly p50: number;
  readonly p95: number;
  readonly worst: number;
  readonly longFrames: number;
  readonly longestFrame: number;
  readonly memoryMb: number | null;
  /** p95 of the chart's own per-frame CPU work (downsampling + upload, and draw calls). */
  readonly prepareP95: number;
  readonly renderP95: number;
  /** Frames drawn with a stale downsampling (the live budget was exceeded). */
  readonly staleFrames: number;
  readonly skipped: string | null;
  /** The tab was hidden during the run and rAF was throttled, so the numbers can't be trusted. */
  readonly hidden: boolean;
}

/**
 * Plays the scripted camera path on a chart and measures it. Each rAF sets the next view, so frame
 * time includes everything a user would feel: the zoom update, decimation, upload and drawing.
 */
export function runScenario(
  chart: TimeSeriesChart,
  monitor: PerfMonitor,
  durationMs = SCENARIO_MS,
): Promise<ScenarioMeasurement> {
  return new Promise((resolve) => {
    const extent = chart.extent;
    const deltas: number[] = [];
    const reports: FrameReport[] = [];
    const unsubscribe = chart.onFrame((report) => reports.push(report));
    let hidden = false;
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') hidden = true;
    };
    document.addEventListener('visibilitychange', onVisibility);
    onVisibility();

    monitor.reset();
    chart.setInteracting(true);
    let start: number | null = null;
    let last: number | null = null;

    const step = (now: number) => {
      start ??= now;
      if (last !== null) deltas.push(now - last);
      last = now;
      const u = (now - start) / durationMs;
      chart.zoomTo(scenarioDomain(Math.min(1, u), extent));
      if (u < 1) {
        requestAnimationFrame(step);
        return;
      }
      chart.setInteracting(false);
      chart.zoomTo(extent);
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisibility);
      const snapshot = monitor.snapshot();
      const elapsed = now - start;
      resolve({
        frames: deltas.length,
        durationMs: elapsed,
        fps: elapsed > 0 ? (deltas.length / elapsed) * 1_000 : 0,
        p50: percentile(deltas, 50),
        p95: percentile(deltas, 95),
        worst: deltas.length ? Math.max(...deltas) : 0,
        longFrames: snapshot.longFrames,
        longestFrame: snapshot.longestFrame,
        memoryMb: snapshot.memoryMb,
        prepareP95: percentile(
          reports.map((r) => r.prepareMs),
          95,
        ),
        renderP95: percentile(
          reports.map((r) => r.renderMs),
          95,
        ),
        staleFrames: reports.filter((r) => r.stale).length,
        skipped: reports.find((r) => r.skipped)?.skipped ?? null,
        hidden,
      });
    };
    requestAnimationFrame(step);
  });
}
