<script setup lang="ts">
import { useLocale } from "#webUi/composables/useLocale";
defineProps<{ message?: string }>();
const { t } = useLocale();
</script>
<template>
  <div class="empty">{{ message || t("noData") }}</div>
</template>
<style scoped>
.empty {
  padding: 32px 18px;
  border: 1px dashed var(--line);
  color: var(--muted);
  text-align: center;
  background: var(--surface-soft);
}
</style>
