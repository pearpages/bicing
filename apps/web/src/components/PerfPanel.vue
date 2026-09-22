<script setup lang="ts">
import type { FrameReport } from '@bicing/charts';
import { computed } from 'vue';
import { FRAME_BUDGET_MS, type PerfSnapshot } from '../benchmark/perfMonitor';
import type { LoadTiming } from '../data/useDataset';
import { formatDuration, formatInt, formatMs } from '../format';
import FrameTrace from './FrameTrace.vue';
import classes from './PerfPanel.module.scss';

const props = defineProps<{
  snapshot: PerfSnapshot | null;
  report: FrameReport | null;
  timing: LoadTiming | null;
}>();

const NO_FRAMES = new Float64Array(0);

const overBudget = computed(() =>
  props.snapshot ? props.snapshot.p95 > FRAME_BUDGET_MS * 1.5 : false,
);
const memory = computed(() => {
  const s = props.snapshot;
  if (s?.memoryMb == null) return 'Not available in this browser';
  return `${formatInt(s.memoryMb)} MB ${s.memorySource === 'page' ? '(page and workers)' : '(JS heap)'}`;
});
</script>

<template>
  <aside :class="classes.panel" aria-label="Performance">
    <p :class="[classes.fps, overBudget && classes.fpsBad]" aria-live="off">
      <span :class="classes.fpsValue">{{ snapshot ? formatInt(snapshot.fps) : '–' }}</span>
      <span :class="classes.fpsUnit">frames per second</span>
    </p>

    <FrameTrace :trace="snapshot?.trace ?? NO_FRAMES" />

    <dl :class="classes.list">
      <div :class="classes.row">
        <dt>Frame time, median and 95th percentile</dt>
        <dd>{{ snapshot ? `${formatMs(snapshot.p50)} and ${formatMs(snapshot.p95)}` : '–' }}</dd>
      </div>
      <div :class="classes.row">
        <dt>Frames over 50 ms</dt>
        <dd>
          {{ snapshot ? formatInt(snapshot.longFrames) : '–' }}
          <template v-if="snapshot && snapshot.longFrames > 0">
            (longest {{ formatMs(snapshot.longestFrame) }})
          </template>
        </dd>
      </div>
      <div :class="classes.row">
        <dt>Memory</dt>
        <dd>{{ memory }}</dd>
      </div>
    </dl>

    <h2 :class="classes.heading">Last chart frame</h2>
    <dl v-if="report" :class="classes.list">
      <div :class="classes.row">
        <dt>Points sent to the renderer</dt>
        <dd>{{ formatInt(report.uploadedPoints) }} of {{ formatInt(report.totalPoints) }}</dd>
      </div>
      <div :class="classes.row">
        <dt>Points drawn after culling</dt>
        <dd>{{ formatInt(report.drawnPoints) }} in {{ formatInt(report.drawCalls) }} draw calls</dd>
      </div>
      <div :class="classes.row">
        <dt>Downsampling and upload</dt>
        <dd>{{ formatMs(report.prepareMs) }}</dd>
      </div>
      <div :class="classes.row">
        <dt>Draw call CPU time</dt>
        <dd>{{ formatMs(report.renderMs) }}</dd>
      </div>
    </dl>
    <p v-else :class="classes.note">Waiting for the first frame.</p>
    <p v-if="report?.stale" :class="classes.note">
      Showing the previous downsampling while you zoom. It refines when you stop.
    </p>
    <p v-if="report?.skipped" :class="[classes.note, classes.warning]">
      {{ report.skipped }}. Pick a smaller dataset or turn on downsampling.
    </p>

    <h2 :class="classes.heading">Loading</h2>
    <dl v-if="timing" :class="classes.list">
      <div :class="classes.row">
        <dt>Generated in the worker</dt>
        <dd>{{ formatDuration(timing.workerMs) }}</dd>
      </div>
      <div :class="classes.row">
        <dt>Time to first chart</dt>
        <dd>
          {{ timing.firstChartMs === null ? 'Drawing…' : formatDuration(timing.firstChartMs) }}
        </dd>
      </div>
    </dl>
  </aside>
</template>
