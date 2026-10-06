<script setup lang="ts">
import { X } from "@lucide/vue";
defineProps<{ message: string; warning?: boolean }>();
defineEmits<{ close: [] }>();
import { useLocale } from "#webUi/composables/useLocale";
const { t } = useLocale();
</script>
<template>
  <div v-if="message" class="notice" :class="{ warning }" role="status">
    <span>{{ message }}</span
    ><button type="button" :aria-label="t('dismissNotice')" @click="$emit('close')"><X :size="18" /></button>
  </div>
</template>
<style scoped>
.notice {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: var(--space-xs) var(--space-sm);
  color: var(--color-success);
  border-bottom: 1px solid var(--color-success-rule);
  background: var(--color-success-soft);
}
.notice.warning {
  color: var(--color-warning);
  border-color: var(--color-warning-rule);
  background: var(--color-warning-soft);
}
.notice button {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border: 0;
  border-radius: var(--radius-control);
  color: currentColor;
  background: transparent;
}
.notice button:hover {
  background: color-mix(in oklch, currentColor 10%, transparent);
}
</style>
