<script setup lang="ts">
import { computed } from "vue";
import type { TaskDetail } from "#webUi/types/api";
import DataList from "#webUi/components/molecules/DataList.vue";
import EmptyState from "#webUi/components/atoms/EmptyState.vue";
import MindMapBranch from "#webUi/components/molecules/MindMapBranch.vue";
import SectionHeader from "#webUi/components/molecules/SectionHeader.vue";
import { useLocale } from "#webUi/composables/useLocale";
import { deriveCurrentStatus } from "#shared/currentStatus";
interface MindMapNode {
  label?: string;
  children?: MindMapNode[];
}
const props = defineProps<{ detail: TaskDetail }>();
const { t } = useLocale();
const memory = computed(() => props.detail.memory || {});
const mindmap = computed(() => memory.value.mindmap as { root?: string; children?: MindMapNode[] } | undefined);
const currentStatus = computed(() =>
  deriveCurrentStatus({
    task_compact_summary: props.detail.task.compact_summary,
    context_compact_summary: props.detail.context.data?.compact_summary,
    memory: memory.value,
    latest_activity: props.detail.latest_activity,
    latest_activity_date: props.detail.latest_activity_date,
    latest_next_activity: props.detail.latest_next_activity,
    latest_next_activity_date: props.detail.latest_next_activity_date,
  }),
);
const summary = computed(() => currentStatus.value.summary);
const issueValues = computed(() => {
  const { risks, next } = currentStatus.value;
  return { ...(risks.length ? { risks } : {}), ...(next.length ? { next } : {}) };
});
</script>
<template>
  <div class="current-status">
    <div class="current-grid">
      <section class="surface block summary-block">
        <SectionHeader :title="t('taskSummary')" />
        <DataList v-if="summary.length" :value="{ summary }" :labels="{ summary: t('summary') }" />
        <EmptyState v-else :message="t('noTaskSummary')" />
      </section>
      <section class="surface block issues-block">
        <SectionHeader :title="t('currentIssues')" />
        <DataList
          v-if="Object.keys(issueValues).length"
          :value="issueValues"
          :labels="{ risks: t('risks'), next: t('nextActions') }"
        />
        <EmptyState v-else :message="t('noCurrentIssues')" />
      </section>
      <section class="surface block">
        <SectionHeader :title="t('selectedDateActivity')" />
        <div v-if="detail.activity?.entries?.length" class="activities">
          <article v-for="(entry, index) in detail.activity.entries" :key="index"><DataList :value="entry" /></article>
        </div>
        <EmptyState v-else :message="t('noActivity')" />
      </section>
      <section class="surface block mindmap-block">
        <SectionHeader :title="t('mindMap')"><slot name="mindmap-action" /></SectionHeader>
        <div v-if="mindmap" class="mindmap">
          <strong>{{ mindmap.root }}</strong>
          <ul>
            <MindMapBranch v-for="(node, index) in mindmap.children || []" :key="index" :node="node" />
          </ul>
        </div>
        <EmptyState v-else :message="t('mindMapEmpty')" />
      </section>
    </div>
  </div>
</template>
<style scoped>
.current-status {
  min-width: 0;
  container-type: inline-size;
}
.block {
  padding: var(--space-md);
}
.current-grid {
  display: grid;
  grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr);
  gap: var(--space-sm);
  align-items: start;
}
.current-grid > :nth-child(n + 3) {
  grid-column: 1 / -1;
}
.current-grid > * {
  min-width: 0;
}
.block :deep(.heading) {
  margin-bottom: 14px;
}
.activities {
  display: grid;
  gap: 10px;
}
.activities article {
  padding: 0 12px;
  border: 1px solid var(--line);
}
.mindmap {
  max-height: calc(100vh - 260px);
  overflow: auto;
  padding: 20px;
  background: var(--surface-soft);
}
.mindmap > strong {
  display: inline-block;
  padding: 12px 18px;
  color: var(--color-on-accent);
  border-radius: 5px;
  background: var(--accent);
}
@media (max-width: 840px) {
  .current-grid {
    grid-template-columns: 1fr;
  }
  .current-grid > :nth-child(n) {
    grid-column: 1;
  }
}
@container (max-width: 760px) {
  .current-grid {
    grid-template-columns: 1fr;
  }
  .current-grid > :nth-child(n) {
    grid-column: 1;
  }
}
.mindmap > ul {
  display: grid;
  gap: 12px;
  padding-left: 28px;
}
</style>
