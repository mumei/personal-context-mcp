<script setup lang="ts">
defineProps<{ label: string }>();
</script>

<template>
  <button class="icon-button" type="button" :aria-label="label" :title="label"><slot /></button>
</template>

<style scoped>
.icon-button {
  display: inline-grid;
  width: var(--control-height);
  height: var(--control-height);
  padding: 0;
  place-items: center;
  border: 1px solid var(--line);
  border-radius: var(--radius-control);
  color: inherit;
  background: transparent;
  transition:
    border-color var(--duration-control) var(--ease-control),
    background-color var(--duration-control) var(--ease-control);
}
.icon-button:hover {
  border-color: var(--accent);
  background: var(--accent-soft);
}
</style>
