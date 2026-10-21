<script setup lang="ts">
import type { MonthEntry } from '@bicing/data';
import { useI18n } from '../i18n/useI18n';
import classes from './MonthSelect.module.scss';

defineProps<{ months: readonly MonthEntry[]; disabled?: boolean }>();
const model = defineModel<string | null>({ required: true });
const { t, fmt } = useI18n();
</script>

<template>
  <label :class="classes.field">
    <span :class="classes.legend">{{ t.controls.month }}</span>
    <select v-model="model" :class="classes.select" :disabled="disabled">
      <option v-for="entry in months" :key="entry.month" :value="entry.month">
        {{ fmt.month(entry.month) }}
      </option>
    </select>
  </label>
</template>
