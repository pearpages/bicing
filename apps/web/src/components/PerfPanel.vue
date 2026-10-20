<script setup lang="ts">
import type { FrameReport } from '@bicing/charts';
import { computed } from 'vue';
import { FRAME_BUDGET_MS, type PerfSnapshot } from '../benchmark/perfMonitor';
import type { LoadTiming } from '../data/useDataset';
import { useI18n } from '../i18n/useI18n';
import FrameTrace from './FrameTrace.vue';
import classes from './PerfPanel.module.scss';

const props = defineProps<{
  snapshot: PerfSnapshot | null;
  report: FrameReport | null;
  timing: LoadTiming | null;
}>();

const NO_FRAMES = new Float64Array(0);
const { t, fmt } = useI18n();

const overBudget = computed(() =>
  props.snapshot ? props.snapshot.p95 > FRAME_BUDGET_MS * 1.5 : false,
);
const memory = computed(() => {
  const s = props.snapshot;
  const text = t.value.perf;
  if (s?.memoryMb == null) return text.memoryUnavailable;
  const mb = fmt.value.int(s.memoryMb);
  return s.memorySource === 'page' ? text.memoryPage(mb) : text.memoryHeap(mb);
});
</script>

<template>
  <aside :class="classes.panel" :aria-label="t.perf.label">
    <p :class="[classes.fps, overBudget && classes.fpsBad]" aria-live="off">
      <span :class="classes.fpsValue">{{ snapshot ? fmt.int(snapshot.fps) : '–' }}</span>
      <span :class="classes.fpsUnit">{{ t.perf.fpsUnit }}</span>
    </p>

    <FrameTrace :trace="snapshot?.trace ?? NO_FRAMES" />

    <dl :class="classes.list">
      <div :class="classes.row">
        <dt>{{ t.perf.frameTime }}</dt>
        <dd>
          {{ snapshot ? t.perf.frameTimeValue(fmt.ms(snapshot.p50), fmt.ms(snapshot.p95)) : '–' }}
        </dd>
      </div>
      <div :class="classes.row">
        <dt>{{ t.perf.longFrames }}</dt>
        <dd>
          {{ snapshot ? fmt.int(snapshot.longFrames) : '–' }}
          <template v-if="snapshot && snapshot.longFrames > 0">
            {{ t.perf.longest(fmt.ms(snapshot.longestFrame)) }}
          </template>
        </dd>
      </div>
      <div :class="classes.row">
        <dt>{{ t.perf.memory }}</dt>
        <dd>{{ memory }}</dd>
      </div>
    </dl>

    <h2 :class="classes.heading">{{ t.perf.lastFrame }}</h2>
    <dl v-if="report" :class="classes.list">
      <div :class="classes.row">
        <dt>{{ t.perf.pointsSent }}</dt>
        <dd>
          {{ t.perf.pointsSentValue(fmt.int(report.uploadedPoints), fmt.int(report.totalPoints)) }}
        </dd>
      </div>
      <div :class="classes.row">
        <dt>{{ t.perf.pointsDrawn }}</dt>
        <dd>
          {{ t.perf.pointsDrawnValue(fmt.int(report.drawnPoints), report.drawCalls) }}
        </dd>
      </div>
      <div :class="classes.row">
        <dt>{{ t.perf.prepare }}</dt>
        <dd>{{ fmt.ms(report.prepareMs) }}</dd>
      </div>
      <div :class="classes.row">
        <dt>{{ t.perf.renderCpu }}</dt>
        <dd>{{ fmt.ms(report.renderMs) }}</dd>
      </div>
    </dl>
    <p v-else :class="classes.note">{{ t.perf.waiting }}</p>
    <p v-if="report?.stale" :class="classes.note">{{ t.perf.stale }}</p>
    <p v-if="report?.skipped" :class="[classes.note, classes.warning]">
      {{ report.skipped }}. {{ t.perf.skippedHint }}
    </p>

    <h2 :class="classes.heading">{{ t.perf.loading }}</h2>
    <dl v-if="timing" :class="classes.list">
      <div :class="classes.row">
        <dt>{{ t.perf.generated }}</dt>
        <dd>{{ fmt.duration(timing.workerMs) }}</dd>
      </div>
      <div :class="classes.row">
        <dt>{{ t.perf.firstChart }}</dt>
        <dd>
          {{ timing.firstChartMs === null ? t.perf.drawing : fmt.duration(timing.firstChartMs) }}
        </dd>
      </div>
    </dl>
  </aside>
</template>
