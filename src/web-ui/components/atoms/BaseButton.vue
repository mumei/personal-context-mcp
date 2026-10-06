<script setup lang="ts">
withDefaults(
  defineProps<{ variant?: "primary" | "secondary" | "ghost" | "danger"; disabled?: boolean; title?: string }>(),
  { variant: "secondary", disabled: false },
);
</script>

<template>
  <button class="button" :class="`button--${variant}`" :disabled="disabled" :title="title"><slot /></button>
</template>

<style scoped>
.button {
  min-height: var(--control-height);
  padding: var(--space-2xs) var(--space-xs);
  border: 1px solid var(--line);
  border-radius: var(--radius-control);
  background: var(--surface);
  color: var(--text);
  font-weight: 650;
  white-space: nowrap;
  transition:
    border-color var(--duration-control) var(--ease-control),
    background-color var(--duration-control) var(--ease-control),
    transform var(--duration-control) var(--ease-control);
}
.button:hover:not(:disabled) {
  border-color: var(--accent);
  background: var(--color-accent-soft);
}
.button:active:not(:disabled) {
  transform: translateY(1px);
}
.button:disabled {
  cursor: default;
  opacity: 0.55;
}
.button--primary {
  color: var(--color-on-accent);
  border-color: var(--accent);
  background: var(--accent);
}
.button--primary:hover:not(:disabled) {
  border-color: var(--color-accent-hover);
  background: var(--color-accent-hover);
}
.button--ghost {
  border-color: transparent;
  background: transparent;
}
.button--danger {
  color: var(--color-on-accent);
  border-color: var(--danger);
  background: var(--danger);
}
</style>
