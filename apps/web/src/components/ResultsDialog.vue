<script setup lang="ts">
import { ref, watch } from 'vue';
import type { BenchmarkResult } from '../benchmark/results';
import { configLabel } from '../benchmark/results';
import { formatInt, formatMs } from '../format';
import classes from './ResultsDialog.module.scss';

const props = defineProps<{
  open: boolean;
  results: readonly BenchmarkResult[];
  markdown: string;
}>();
const emit = defineEmits<{ close: [] }>();

const dialog = ref<HTMLDialogElement | null>(null);
const copied = ref(false);

watch(
  () => props.open,
  (open) => {
    if (open && !dialog.value?.open) dialog.value?.showModal();
    if (!open) dialog.value?.close();
  },
);

async function copy(): Promise<void> {
  await navigator.clipboard.writeText(props.markdown);
  copied.value = true;
  setTimeout(() => (copied.value = false), 2_000);
}
</script>

<template>
  <dialog
    ref="dialog"
    :class="classes.dialog"
    aria-labelledby="results-title"
    @close="emit('close')"
  >
    <header :class="classes.header">
      <h2 id="results-title" :class="classes.title">Benchmark results</h2>
      <div :class="classes.actions">
        <button type="button" :class="classes.button" :disabled="!markdown" @click="copy">
          {{ copied ? 'Copied' : 'Copy as Markdown' }}
        </button>
        <button type="button" :class="classes.button" @click="emit('close')">Close</button>
      </div>
    </header>
    <p :class="classes.note">
      Each run plays the same 5-second zoom and pan. Keep this tab in the foreground: hidden tabs
      throttle frames.
    </p>
    <div :class="classes.scroll">
      <table :class="classes.table">
        <thead>
          <tr>
            <th scope="col">Configuration</th>
            <th scope="col">FPS</th>
            <th scope="col">Frame p95</th>
            <th scope="col">Frames over 50 ms</th>
            <th scope="col">First chart</th>
            <th scope="col">Notes</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="result in results" :key="configLabel(result.config)">
            <th scope="row">{{ configLabel(result.config) }}</th>
            <td>
              {{
                result.measurement && !result.measurement.skipped
                  ? formatInt(result.measurement.fps)
                  : '–'
              }}
            </td>
            <td>{{ result.measurement ? formatMs(result.measurement.p95) : '–' }}</td>
            <td>{{ result.measurement ? formatInt(result.measurement.longFrames) : '–' }}</td>
            <td>{{ result.firstChartMs === null ? '–' : formatMs(result.firstChartMs) }}</td>
            <td>
              {{
                result.error ??
                result.measurement?.invalid ??
                result.measurement?.skipped ??
                (result.measurement?.staleFrames
                  ? `${result.measurement.staleFrames} stale frames`
                  : '')
              }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </dialog>
</template>
