<script setup lang="ts">
defineProps<{
  modelValue: boolean;
  label: string;
  disabled?: boolean;
}>();

defineEmits<{
  "update:modelValue": [value: boolean];
}>();
</script>

<template>
  <label class="toggle" :class="{ disabled }">
    <span>{{ label }}</span>
    <input
      type="checkbox"
      role="switch"
      :checked="modelValue"
      :disabled="disabled"
      @change="$emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
    />
    <span class="track" aria-hidden="true"><span /></span>
  </label>
</template>

<style scoped>
.toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--muted);
  font-size: var(--text-xs);
  font-weight: 650;
  cursor: pointer;
}
.toggle.disabled {
  cursor: wait;
  opacity: 0.65;
}
input {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
.track {
  display: inline-flex;
  width: 34px;
  height: 20px;
  align-items: center;
  padding: 2px;
  border: 1px solid var(--color-rule-strong);
  border-radius: 999px;
  background: var(--color-paper-2);
  transition:
    border-color 120ms ease,
    background 120ms ease;
}
.track span {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--muted);
  transition:
    transform 120ms ease,
    background 120ms ease;
}
input:checked + .track {
  border-color: var(--accent);
  background: var(--accent);
}
input:checked + .track span {
  background: var(--color-on-accent);
  transform: translateX(14px);
}
input:focus-visible + .track {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}
</style>
