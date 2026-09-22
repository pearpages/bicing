import type { FrameReport } from '@bicing/charts';
import { onBeforeUnmount, onMounted, shallowRef, type ShallowRef } from 'vue';
import { PerfMonitor, type PerfSnapshot } from './perfMonitor';

/** The overlay refreshes 4× a second. Re-rendering Vue on every frame would itself cost frames. */
const REFRESH_MS = 250;

export interface PerfState {
  readonly monitor: PerfMonitor;
  readonly snapshot: ShallowRef<PerfSnapshot | null>;
  readonly report: ShallowRef<FrameReport | null>;
  /** Hand every chart frame report here; it's buffered and published with the next refresh. */
  recordFrame(report: FrameReport): void;
}

export function usePerfMonitor(): PerfState {
  const monitor = new PerfMonitor();
  const snapshot = shallowRef<PerfSnapshot | null>(null);
  const report = shallowRef<FrameReport | null>(null);
  let latestReport: FrameReport | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  onMounted(() => {
    monitor.start();
    timer = setInterval(() => {
      snapshot.value = monitor.snapshot();
      if (latestReport !== report.value) report.value = latestReport;
    }, REFRESH_MS);
  });

  onBeforeUnmount(() => {
    monitor.stop();
    if (timer !== null) clearInterval(timer);
  });

  return {
    monitor,
    snapshot,
    report,
    recordFrame(next) {
      latestReport = next;
    },
  };
}
