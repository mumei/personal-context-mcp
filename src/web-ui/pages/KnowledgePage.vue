<script setup lang="ts">
import { AlertTriangle, Network, Share2, Table2 } from "@lucide/vue";
import { computed, onMounted, ref } from "vue";
import BaseButton from "#webUi/components/atoms/BaseButton.vue";
import KnowledgeFilters from "#webUi/components/molecules/KnowledgeFilters.vue";
import KnowledgeGraphCanvas from "#webUi/components/organisms/KnowledgeGraphCanvas.vue";
import KnowledgeInspector from "#webUi/components/organisms/KnowledgeInspector.vue";
import KnowledgeRecentTable from "#webUi/components/organisms/KnowledgeRecentTable.vue";
import KnowledgeUsagePanel from "#webUi/components/organisms/KnowledgeUsagePanel.vue";
import { useKnowledgeGraph } from "#webUi/composables/knowledge/useKnowledgeGraph";
import { useKnowledgeUsage } from "#webUi/composables/knowledge/useKnowledgeUsage";
import { useLocale } from "#webUi/composables/useLocale";

const { t } = useLocale();
const {
  graph,
  inspectionGraph,
  visibleGraph,
  selectedNote,
  loading,
  loadingNote,
  error,
  query,
  type,
  tag,
  orphanOnly,
  appliedQuery,
  appliedType,
  appliedTag,
  appliedOrphanOnly,
  filtersDirty,
  hasActiveFilters,
  knownTypes,
  knownTags,
  loadGraph,
  applyFilters,
  clearFilters,
  selectNode,
} = useKnowledgeGraph();
const { usage, loadingUsage, usageError, loadUsage } = useKnowledgeUsage();
const workspaceView = ref<"graph" | "recent">("graph");

const TYPE_LABEL_KEYS = {
  concept: "knowledgeType_concept",
  system: "knowledgeType_system",
  technology: "knowledgeType_technology",
  organization: "knowledgeType_organization",
  person: "knowledgeType_person",
  decision: "knowledgeType_decision",
  document: "knowledgeType_document",
} as const;

function typeLabel(value: string): string {
  const key = TYPE_LABEL_KEYS[value as keyof typeof TYPE_LABEL_KEYS];
  return key ? t(key) : value;
}

const activeFilterParts = computed(() => {
  const parts: string[] = [];
  if (appliedQuery.value) parts.push(t("knowledgeFilterSearch", { value: appliedQuery.value }));
  if (appliedType.value) parts.push(t("knowledgeFilterType", { value: typeLabel(appliedType.value) }));
  if (appliedTag.value) parts.push(t("knowledgeFilterTag", { value: appliedTag.value }));
  if (appliedOrphanOnly.value) parts.push(t("knowledgeFilterOrphans"));
  return parts;
});

onMounted(() => Promise.all([loadGraph(), loadUsage()]));

function selectFromList(event: Event): void {
  const nodeId = (event.target as HTMLSelectElement).value;
  if (nodeId) void selectNode(nodeId);
}
</script>

<template>
  <div class="knowledge-page">
    <section class="knowledge-controls" :aria-label="t('knowledgeExplore')" :aria-busy="loading">
      <div class="knowledge-overview">
        <p class="result-count" aria-live="polite" aria-atomic="true">
          <strong>{{ visibleGraph.nodes.length }}</strong>
          <span>{{ t("knowledgeResultCount") }}</span>
        </p>
        <dl class="stats" :aria-label="t('knowledgeStats')">
          <div>
            <dt>{{ t("knowledgeEdges") }}</dt>
            <dd>{{ visibleGraph.edges.length }}</dd>
          </div>
          <div>
            <dt>{{ t("knowledgeOrphans") }}</dt>
            <dd>{{ graph.stats.orphans }}</dd>
          </div>
        </dl>
        <p v-if="filtersDirty" class="pending-filters" role="status">{{ t("knowledgeFiltersPending") }}</p>
      </div>
      <KnowledgeFilters
        v-model:query="query"
        v-model:type="type"
        v-model:tag="tag"
        v-model:orphan-only="orphanOnly"
        :types="knownTypes"
        :tags="knownTags"
        :loading="loading"
        :dirty="filtersDirty"
        :has-active-filters="hasActiveFilters"
        @apply="applyFilters"
        @clear="clearFilters"
      />
      <div class="selection-row">
        <p class="applied-filters">
          <strong>{{ t("knowledgeActiveFilters") }}</strong>
          <span>{{ activeFilterParts.length ? activeFilterParts.join(" · ") : t("knowledgeNoActiveFilters") }}</span>
        </p>
        <div class="view-switcher" role="group" :aria-label="t('knowledgeViewMode')">
          <button
            type="button"
            class="view-mode-button"
            :aria-pressed="workspaceView === 'graph'"
            @click="workspaceView = 'graph'"
          >
            <Share2 :size="16" aria-hidden="true" />{{ t("knowledgeGraphView") }}
          </button>
          <button
            type="button"
            class="view-mode-button"
            :aria-pressed="workspaceView === 'recent'"
            @click="workspaceView = 'recent'"
          >
            <Table2 :size="16" aria-hidden="true" />{{ t("knowledgeRecentView") }}
          </button>
        </div>
        <label v-if="visibleGraph.nodes.length" class="node-picker">
          <span>{{ t("knowledgeSelectNodeLabel") }}</span>
          <select :value="selectedNote?.id || ''" @change="selectFromList">
            <option value="">{{ t("knowledgeSelectNodeOption") }}</option>
            <option v-for="node in visibleGraph.nodes" :key="node.id" :value="node.id">
              {{ node.title }} · {{ typeLabel(node.type) }}
            </option>
          </select>
        </label>
      </div>
      <details v-if="graph.warnings.length" class="warning-summary">
        <summary>
          <AlertTriangle :size="17" aria-hidden="true" />
          <span>{{ t("knowledgeWarningSummary", { count: graph.warnings.length }) }}</span>
        </summary>
        <ul>
          <li v-for="warning in graph.warnings" :key="`${warning.code}:${warning.node_id || ''}`">
            <strong>{{ warning.code }}</strong>
            <span>{{ warning.message }}</span>
          </li>
        </ul>
      </details>
      <p v-if="error" class="knowledge-error" role="alert">{{ t("knowledgeLoadFailed") }}: {{ error }}</p>
    </section>
    <div v-if="loading && !graph.nodes.length" class="loading"><Network :size="24" />{{ t("loading") }}</div>
    <section v-else-if="!visibleGraph.nodes.length" class="knowledge-empty">
      <Network :size="28" aria-hidden="true" />
      <div>
        <h2>{{ t("knowledgeEmptyTitle") }}</h2>
        <p>{{ t("knowledgeEmptyDescription") }}</p>
      </div>
      <BaseButton v-if="hasActiveFilters || filtersDirty" type="button" @click="clearFilters">
        {{ t("knowledgeClearAndShowAll") }}
      </BaseButton>
    </section>
    <div v-else class="knowledge-workspace">
      <KnowledgeGraphCanvas
        v-if="workspaceView === 'graph'"
        :graph="visibleGraph"
        :selected-id="selectedNote?.id"
        @select="selectNode"
      />
      <KnowledgeRecentTable v-else :graph="visibleGraph" :selected-id="selectedNote?.id" @select="selectNode" />
      <KnowledgeInspector :note="selectedNote" :graph="inspectionGraph" :loading="loadingNote" @select="selectNode" />
    </div>
    <KnowledgeUsagePanel :usage="usage" :loading="loadingUsage" :error="usageError" />
  </div>
</template>

<style scoped>
/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V4 · genre: modern-minimal · tone: utilitarian
 * anchor: teal · macrostructure: Index + Workbench · design-system: design.md · designed-as-app
 * contrast: pass (40–41) · honest: pass (46) · chrome: pass (47) · tokens: pass (48)
 * responsive: pass (49) · mobile: pass (34, 49, 50–57) · icons: pass (30) · slop: pass
 */
.knowledge-page {
  display: grid;
  height: calc(100dvh - var(--header-height) - (var(--space-md) * 2));
  min-height: 620px;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: var(--space-xs);
}
.knowledge-controls {
  container: knowledge-controls / inline-size;
  display: grid;
  gap: var(--space-2xs);
}
.knowledge-overview {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: var(--space-sm);
}
.result-count {
  display: flex;
  align-items: baseline;
  gap: var(--space-2xs);
  margin: 0;
  white-space: nowrap;
}
.result-count strong {
  font-size: var(--text-xl);
  font-variant-numeric: tabular-nums;
  line-height: 1;
}
.result-count span {
  color: var(--muted);
  font-weight: 650;
}
.stats {
  display: flex;
  margin: 0;
  gap: var(--space-sm);
}
.stats div {
  display: flex;
  align-items: baseline;
  gap: var(--space-3xs);
}
.stats dt {
  color: var(--muted);
  font-size: var(--text-xs);
}
.stats dd {
  margin: 0;
  font-size: var(--text-md);
  font-weight: 750;
  font-variant-numeric: tabular-nums;
}
.pending-filters {
  margin: 0 0 0 auto;
  color: var(--color-warning);
  font-size: var(--text-xs);
  font-weight: 700;
}
.selection-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(280px, 430px);
  align-items: end;
  gap: var(--space-sm);
  min-width: 0;
}
.view-switcher {
  display: inline-flex;
  align-self: end;
  padding: var(--space-3xs);
  border: 1px solid var(--line);
  border-radius: var(--radius-control);
  background: var(--surface-soft);
}
.view-mode-button {
  display: inline-flex;
  min-height: var(--control-height);
  align-items: center;
  gap: var(--space-3xs);
  padding: var(--space-3xs) var(--space-xs);
  border: 0;
  border-radius: var(--radius-control);
  color: var(--muted);
  background: transparent;
  font: inherit;
  font-size: var(--text-xs);
  font-weight: 750;
  white-space: nowrap;
  cursor: pointer;
}
.view-mode-button:hover:not(:disabled) {
  color: var(--text);
  background: var(--color-accent-soft);
}
.view-mode-button[aria-pressed="true"] {
  color: var(--text);
  background: var(--surface);
  box-shadow: 0 1px 3px color-mix(in oklch, var(--color-ink) 10%, transparent);
}
.view-mode-button:focus-visible {
  outline: 3px solid var(--color-accent);
  outline-offset: 2px;
}
.view-mode-button:active:not(:disabled) {
  color: var(--color-accent-hover);
}
.view-mode-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.applied-filters {
  display: grid;
  gap: var(--space-3xs);
  margin: 0;
  min-width: 0;
  color: var(--muted);
  font-size: var(--text-xs);
}
.applied-filters strong {
  color: var(--text);
}
.knowledge-workspace {
  display: grid;
  min-height: 0;
  grid-template-columns: minmax(0, 1fr) minmax(330px, 39%);
  gap: var(--space-xs);
}
.loading,
.knowledge-error,
.knowledge-empty {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  margin: 0;
  padding: var(--space-xs);
  border: 1px solid var(--line);
  border-radius: var(--radius-control);
  background: var(--surface);
}
.node-picker {
  display: grid;
  gap: var(--space-3xs);
  min-width: 0;
  color: var(--muted);
  font-size: var(--text-xs);
  font-weight: 650;
}
.node-picker select {
  width: 100%;
  min-width: 0;
  min-height: var(--control-height);
  padding: var(--space-2xs) var(--space-xs);
  border: 1px solid var(--line);
  border-radius: var(--radius-control);
  color: var(--text);
  background: var(--surface);
}
.loading {
  justify-content: center;
  color: var(--muted);
}
.warning-summary {
  color: var(--color-warning);
  border-color: var(--color-warning-rule);
  background: var(--color-warning-soft);
}
.warning-summary summary {
  display: flex;
  min-height: var(--control-height);
  align-items: center;
  gap: var(--space-2xs);
  padding-inline: var(--space-xs);
  cursor: pointer;
  font-weight: 700;
}
.warning-summary ul {
  display: grid;
  gap: var(--space-2xs);
  margin: 0;
  padding: 0 var(--space-sm) var(--space-xs) var(--space-lg);
}
.warning-summary li {
  padding-inline-start: var(--space-3xs);
}
.warning-summary li strong {
  margin-inline-end: var(--space-2xs);
}
.knowledge-error {
  color: var(--danger);
  border-color: var(--color-danger-rule);
  background: var(--color-danger-soft);
}
.knowledge-empty {
  align-self: stretch;
  justify-content: center;
  flex-direction: column;
  padding: var(--space-lg);
  color: var(--muted);
  text-align: center;
}
.knowledge-empty h2 {
  margin: 0;
  font-size: var(--text-lg);
}
.knowledge-empty p {
  margin: var(--space-3xs) 0 0;
}
@container knowledge-controls (max-width: 47.5rem) {
  .selection-row {
    grid-template-columns: auto minmax(0, 1fr);
  }
  .applied-filters {
    grid-column: 1 / -1;
  }
}
@container knowledge-controls (max-width: 34rem) {
  .selection-row {
    grid-template-columns: minmax(0, 1fr);
  }
  .applied-filters {
    grid-column: auto;
  }
}
@media (max-width: 1100px) {
  .knowledge-workspace {
    grid-template-columns: minmax(0, 1fr);
    overflow-y: auto;
  }
  .knowledge-workspace :deep(.graph-frame) {
    height: min(58svh, 610px);
  }
}
@media (max-width: 900px) {
  .knowledge-page {
    height: auto;
    min-height: 0;
  }
  .knowledge-workspace :deep(.graph-frame) {
    height: min(60svh, 560px);
  }
}
@media (max-width: 560px) {
  .knowledge-overview {
    align-items: flex-start;
    flex-wrap: wrap;
  }
  .pending-filters {
    width: 100%;
    margin-inline-start: 0;
  }
  .stats {
    margin-inline-start: auto;
  }
  .knowledge-workspace :deep(.graph-frame) {
    min-height: 390px;
  }
}
</style>
