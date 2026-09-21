<script setup lang="ts">
import classes from './App.module.scss';

// Surfaced in the shell because the memory metric in benchmark mode depends on it.
const isolated = globalThis.crossOriginIsolated;
</script>

<template>
  <div :class="classes.app">
    <header :class="classes.header">
      <h1 :class="classes.title">Bicing Pulse</h1>
      <span :class="classes.badge" data-testid="isolation">
        cross-origin isolated: {{ isolated ? 'yes' : 'no' }}
      </span>
    </header>
    <main :class="classes.main" />
  </div>
</template>
