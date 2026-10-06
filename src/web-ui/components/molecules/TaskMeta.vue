<script setup lang="ts">
import BadgeLabel from "#webUi/components/atoms/BadgeLabel.vue";
import StatusDot from "#webUi/components/atoms/StatusDot.vue";
import type { Task } from "#webUi/types/api";
import { useLocale } from "#webUi/composables/useLocale";
defineProps<{ task: Task; showId?: boolean }>();
const { t } = useLocale();
</script>
<template>
  <span class="meta">
    <strong v-if="task.project">{{ task.project }}</strong>
    <span class="status"><StatusDot :status="task.status" />{{ t(task.status) }}</span>
    <BadgeLabel v-if="task.tier">Tier {{ task.tier }}</BadgeLabel>
    <BadgeLabel v-if="task.report_exclude">{{ t("reportExcluded") }}</BadgeLabel>
    <code v-if="showId">{{ task.id }}</code>
  </span>
</template>
<style scoped>
.meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
  color: var(--muted);
  font-size: 12px;
}
.status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
code {
  overflow-wrap: anywhere;
}
</style>
