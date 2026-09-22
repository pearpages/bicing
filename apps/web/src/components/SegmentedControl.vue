<script setup lang="ts" generic="T extends string | number">
import classes from './SegmentedControl.module.scss';

export interface Option<V> {
  readonly value: V;
  readonly label: string;
  /** Shown as the option's tooltip, e.g. why it's marked as a stress test. */
  readonly title?: string;
  readonly muted?: boolean;
}

defineProps<{
  legend: string;
  name: string;
  options: readonly Option<T>[];
  disabled?: boolean;
}>();

const model = defineModel<T>({ required: true });
</script>

<template>
  <fieldset :class="classes.group" :disabled="disabled">
    <legend :class="classes.legend">{{ legend }}</legend>
    <div :class="classes.options">
      <label
        v-for="option in options"
        :key="String(option.value)"
        :class="[classes.option, option.muted && classes.muted]"
        :title="option.title"
      >
        <input
          v-model="model"
          :class="classes.input"
          type="radio"
          :name="name"
          :value="option.value"
        />
        <span :class="classes.text">{{ option.label }}</span>
      </label>
    </div>
  </fieldset>
</template>
