<script setup lang="ts">
import { ref, watch } from 'vue';
import type { BenchmarkResult } from '../benchmark/results';
import { configLabel, resultNote } from '../benchmark/results';
import { useI18n } from '../i18n/useI18n';
import classes from './ResultsDialog.module.scss';

const props = defineProps<{
  open: boolean;
  results: readonly BenchmarkResult[];
  markdown: string;
}>();
const emit = defineEmits<{ close: [] }>();
const { t, fmt } = useI18n();

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
      <h2 id="results-title" :class="classes.title">{{ t.results.title }}</h2>
      <div :class="classes.actions">
        <button type="button" :class="classes.button" :disabled="!markdown" @click="copy">
          {{ copied ? t.results.copied : t.results.copy }}
        </button>
        <button type="button" :class="classes.button" @click="emit('close')">
          {{ t.results.close }}
        </button>
      </div>
    </header>
    <p :class="classes.note">{{ t.results.note }}</p>
    <div :class="classes.scroll">
      <table :class="classes.table">
        <thead>
          <tr>
            <th scope="col">{{ t.results.columns.config }}</th>
            <th scope="col">{{ t.results.columns.fps }}</th>
            <th scope="col">{{ t.results.columns.p95 }}</th>
            <th scope="col">{{ t.results.columns.longFrames }}</th>
            <th scope="col">{{ t.results.columns.firstChart }}</th>
            <th scope="col">{{ t.results.columns.notes }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="result in results" :key="configLabel(result.config, t.results)">
            <th scope="row">{{ configLabel(result.config, t.results) }}</th>
            <td>
              {{
                result.measurement && !result.measurement.skipped
                  ? fmt.int(result.measurement.fps)
                  : '–'
              }}
            </td>
            <td>{{ result.measurement ? fmt.ms(result.measurement.p95) : '–' }}</td>
            <td>{{ result.measurement ? fmt.int(result.measurement.longFrames) : '–' }}</td>
            <td>{{ result.firstChartMs === null ? '–' : fmt.ms(result.firstChartMs) }}</td>
            <td>{{ resultNote(result, t, fmt) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </dialog>
</template>
