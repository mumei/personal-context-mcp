<script setup lang="ts">
import type { TaskStatus } from "#webUi/types/api";
defineProps<{ status: TaskStatus }>();
</script>

<template><span class="dot" :class="`dot--${status}`" /></template>

<style scoped>
.dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-status-todo);
}
.dot--inProgress {
  background: var(--color-status-progress);
}
.dot--waiting {
  background: var(--color-status-waiting);
}
.dot--blocked {
  background: var(--color-status-blocked);
}
.dot--done {
  background: var(--color-status-done);
}
</style>
