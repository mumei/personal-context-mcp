<script setup lang="ts">
import { useLocale } from "#webUi/composables/useLocale";
defineProps<{ active: string }>();
defineEmits<{ select: [view: string] }>();
const { t } = useLocale();
const tabs = [
  { id: "current", key: "current" },
  { id: "overview", key: "overview" },
  { id: "context", key: "context" },
  { id: "memory", key: "taskMemory" },
] as const;
</script>
<template>
  <div class="tabs" role="tablist">
    <button
      v-for="tab in tabs"
      :key="tab.id"
      type="button"
      :class="{ active: active === tab.id }"
      @click="$emit('select', tab.id)"
    >
      {{ t(tab.key) }}
    </button>
  </div>
</template>
<style scoped>
.tabs {
  display: flex;
  overflow-x: auto;
  padding: 0 18px;
  border-bottom: 1px solid var(--line);
  background: var(--surface);
}
button {
  flex: 0 0 auto;
  height: 46px;
  padding: 0 14px;
  border: 0;
  border-bottom: 3px solid transparent;
  background: transparent;
  color: var(--muted);
}
button.active {
  border-color: var(--accent);
  color: var(--text);
  font-weight: 700;
}
</style>
