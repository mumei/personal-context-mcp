<script setup lang="ts">
/**
 * Renders the currently visible Knowledge notes in creation order and emits read-only selection events.
 *
 * 表示中のKnowledgeノートを作成日時順に並べ、読み取り専用の選択イベントを通知します。
 */
import { computed } from "vue";
import { useLocale } from "#webUi/composables/useLocale";
import type { KnowledgeGraphResponse, KnowledgeNode } from "#webUi/types/api";

const props = defineProps<{ graph: KnowledgeGraphResponse; selectedId?: string }>();
const emit = defineEmits<{ select: [nodeId: string] }>();
const { language, t } = useLocale();

const TYPE_LABEL_KEYS = {
  concept: "knowledgeType_concept",
  system: "knowledgeType_system",
  technology: "knowledgeType_technology",
  organization: "knowledgeType_organization",
  person: "knowledgeType_person",
  decision: "knowledgeType_decision",
  document: "knowledgeType_document",
} as const;

const relationCounts = computed(() => {
  const counts = new Map<string, number>();
  for (const edge of props.graph.edges) {
    counts.set(edge.source, (counts.get(edge.source) ?? 0) + 1);
    counts.set(edge.target, (counts.get(edge.target) ?? 0) + 1);
  }
  return counts;
});

const recentNodes = computed(() =>
  [...props.graph.nodes].sort((left, right) => {
    const timeDifference = createdAtValue(right) - createdAtValue(left);
    return timeDifference || left.id.localeCompare(right.id);
  }),
);

function createdAtValue(node: KnowledgeNode): number {
  const value = node.created_at ? Date.parse(node.created_at) : Number.NaN;
  return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

function formatCreatedAt(value?: string): string {
  if (!value || !Number.isFinite(Date.parse(value))) return t("knowledgeUnknown");
  return new Intl.DateTimeFormat(language.value === "en" ? "en-US" : "ja-JP", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function typeLabel(value: string): string {
  const key = TYPE_LABEL_KEYS[value as keyof typeof TYPE_LABEL_KEYS];
  return key ? t(key) : value;
}
</script>

<template>
  <section class="knowledge-table-panel">
    <header class="knowledge-table-heading">
      <div>
        <h2 id="knowledge-recent-title">{{ t("knowledgeRecentTitle") }}</h2>
        <p>{{ t("knowledgeRecentDescription") }}</p>
      </div>
      <strong>{{ t("knowledgeRecentCount", { count: recentNodes.length }) }}</strong>
    </header>
    <div class="knowledge-table-scroll" role="region" tabindex="0" aria-labelledby="knowledge-recent-title">
      <table>
        <caption class="sr-only">
          {{
            t("knowledgeRecentTableCaption")
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t("knowledgeAddedAt") }}</th>
            <th scope="col">{{ t("knowledgeTableNote") }}</th>
            <th scope="col">{{ t("knowledgeType") }}</th>
            <th scope="col" class="count-column">{{ t("knowledgeConnections") }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="node in recentNodes" :key="node.id" :class="{ selected: node.id === selectedId }">
            <td class="date-cell">
              <time v-if="node.created_at" :datetime="node.created_at">{{ formatCreatedAt(node.created_at) }}</time>
              <span v-else>{{ t("knowledgeUnknown") }}</span>
            </td>
            <td class="note-cell">
              <button
                type="button"
                class="knowledge-table-title"
                :aria-current="node.id === selectedId ? 'true' : undefined"
                :aria-label="t('knowledgeOpenDetails', { title: node.title })"
                @click="emit('select', node.id)"
              >
                {{ node.title }}
              </button>
              <p v-if="node.summary">{{ node.summary }}</p>
            </td>
            <td>
              <span class="type-label">{{ typeLabel(node.type) }}</span>
            </td>
            <td class="count-cell">{{ relationCounts.get(node.id) ?? 0 }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.knowledge-table-panel {
  display: grid;
  min-width: 0;
  min-height: 430px;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius-surface);
  background: var(--surface);
}
.knowledge-table-heading {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: var(--space-sm);
  padding: var(--space-sm);
  border-bottom: 1px solid var(--line);
}
.knowledge-table-heading h2,
.knowledge-table-heading p {
  margin: 0;
}
.knowledge-table-heading h2 {
  font-size: var(--text-lg);
}
.knowledge-table-heading p {
  margin-top: var(--space-3xs);
  color: var(--muted);
  font-size: var(--text-xs);
}
.knowledge-table-heading strong {
  flex: none;
  color: var(--muted);
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
}
.knowledge-table-scroll {
  min-width: 0;
  min-height: 0;
  overflow: auto;
}
.knowledge-table-scroll:focus-visible {
  outline: 3px solid var(--color-accent);
  outline-offset: -3px;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
table {
  width: 100%;
  min-width: 560px;
  border-collapse: collapse;
}
th,
td {
  padding: var(--space-xs) var(--space-sm);
  border-bottom: 1px solid var(--line);
  text-align: left;
  vertical-align: top;
}
th {
  position: sticky;
  z-index: 1;
  top: 0;
  color: var(--muted);
  background: var(--surface-soft);
  font-size: var(--text-xs);
  font-weight: 750;
  white-space: nowrap;
}
tbody tr {
  transition: background-color var(--duration-control) var(--ease-control);
}
tbody tr:hover,
tbody tr.selected {
  background: var(--color-accent-soft);
}
tbody tr:last-child td {
  border-bottom: 0;
}
.date-cell {
  width: 150px;
  color: var(--muted);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.note-cell {
  width: 100%;
  min-width: 220px;
}
.knowledge-table-title {
  display: block;
  width: 100%;
  min-height: 28px;
  padding: 0;
  overflow: hidden;
  border: 0;
  color: var(--text);
  background: transparent;
  font: inherit;
  font-weight: 750;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.knowledge-table-title:hover {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.knowledge-table-title:focus-visible {
  border-radius: 2px;
  outline: 3px solid var(--color-accent);
  outline-offset: 3px;
}
.knowledge-table-title:active {
  color: var(--color-accent-hover);
}
.knowledge-table-title:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.note-cell p {
  display: -webkit-box;
  margin: var(--space-3xs) 0 0;
  overflow: hidden;
  color: var(--muted);
  font-size: var(--text-xs);
  line-height: 1.45;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.type-label {
  color: var(--muted);
  font-size: var(--text-xs);
  font-weight: 700;
  white-space: nowrap;
}
.count-column,
.count-cell {
  width: 1%;
  text-align: right;
}
.count-cell {
  font-weight: 750;
  font-variant-numeric: tabular-nums;
}
@media (max-width: 560px) {
  .knowledge-table-heading {
    padding: var(--space-xs);
  }
  th,
  td {
    padding: var(--space-2xs) var(--space-xs);
  }
}
</style>
