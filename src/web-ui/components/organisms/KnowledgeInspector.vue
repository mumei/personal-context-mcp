<script setup lang="ts">
/**
 * Presents the selected self-contained knowledge note, evidence, relationships, and audit warnings.
 *
 * 選択した自己完結型Knowledgeノート、根拠、関係、監査警告を表示します。
 */
import { computed } from "vue";
import BadgeLabel from "#webUi/components/atoms/BadgeLabel.vue";
import EmptyState from "#webUi/components/atoms/EmptyState.vue";
import { useLocale } from "#webUi/composables/useLocale";
import type { KnowledgeGraphResponse, KnowledgeNode } from "#webUi/types/api";

const props = defineProps<{ note?: KnowledgeNode; graph: KnowledgeGraphResponse; loading?: boolean }>();
const emit = defineEmits<{ select: [nodeId: string] }>();
const { t } = useLocale();

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

const relations = computed(() => {
  if (!props.note) return [];
  const byId = new Map(props.graph.nodes.map((node) => [node.id, node]));
  return props.graph.edges
    .filter((edge) => edge.source === props.note?.id || edge.target === props.note?.id)
    .map((edge) => {
      const outgoing = edge.source === props.note?.id;
      const relatedId = outgoing ? edge.target : edge.source;
      return { ...edge, direction: outgoing ? "outgoing" : "incoming", related: byId.get(relatedId) };
    });
});

const warnings = computed(() =>
  props.graph.warnings.filter((warning) => !warning.node_id || warning.node_id === props.note?.id),
);
</script>

<template>
  <aside class="inspector" :aria-label="t('knowledgeInspector')">
    <p class="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {{ loading ? t("loading") : note?.title || t("knowledgeSelectNode") }}
    </p>
    <p v-if="loading" class="muted">{{ t("loading") }}</p>
    <EmptyState v-else-if="!note" :message="t('knowledgeSelectNode')" />
    <template v-else>
      <header>
        <div>
          <h2>{{ note.title }}</h2>
        </div>
        <BadgeLabel>{{ typeLabel(note.type) }}</BadgeLabel>
      </header>
      <p v-if="note.summary" class="summary">{{ note.summary }}</p>
      <dl class="audit-meta">
        <div>
          <dt>{{ t("knowledgeUpdatedAt") }}</dt>
          <dd>{{ note.updated_at || t("knowledgeUnknown") }}</dd>
        </div>
        <div>
          <dt>{{ t("knowledgeRelations") }}</dt>
          <dd>{{ relations.length }}</dd>
        </div>
      </dl>
      <div v-if="note.tags?.length" class="tag-list" :aria-label="t('knowledgeTags')">
        <BadgeLabel v-for="item in note.tags" :key="item">{{ item }}</BadgeLabel>
      </div>
      <section v-if="note.aliases?.length" class="inspector-section">
        <h3>{{ t("knowledgeAliases") }}</h3>
        <ul>
          <li v-for="alias in note.aliases" :key="alias">{{ alias }}</li>
        </ul>
      </section>
      <section class="inspector-section">
        <h3>{{ t("knowledgeRelations") }}</h3>
        <ul v-if="relations.length" class="relation-list">
          <li v-for="relation in relations" :key="relation.id">
            <button
              type="button"
              class="relation-button"
              :disabled="!relation.related"
              @click="relation.related && emit('select', relation.related.id)"
            >
              <span>{{ relation.direction === "outgoing" ? "→" : "←" }}</span>
              <strong>{{ relation.label || relation.type }}</strong>
              <span>{{
                relation.related?.title || (relation.direction === "outgoing" ? relation.target : relation.source)
              }}</span>
            </button>
          </li>
        </ul>
        <p v-else class="muted">{{ t("knowledgeNoRelations") }}</p>
      </section>
      <section v-if="warnings.length" class="inspector-section warnings">
        <h3>{{ t("knowledgeWarnings") }}</h3>
        <ul>
          <li v-for="warning in warnings" :key="`${warning.code}:${warning.node_id || ''}`">
            <strong>{{ warning.code }}</strong
            ><span>{{ warning.message }}</span>
          </li>
        </ul>
      </section>
      <details v-if="note.body_html" class="inspector-section inspector-disclosure" open>
        <summary>{{ t("knowledgeDetails") }}</summary>
        <div class="markdown-body disclosure-content" v-html="note.body_html"></div>
      </details>
      <details class="inspector-section inspector-disclosure">
        <summary>{{ t("knowledgeEvidence") }}</summary>
        <div class="disclosure-content">
          <ul v-if="note.evidence?.length" class="evidence-list">
            <li v-for="(evidence, index) in note.evidence" :key="index">
              <strong>{{ evidence.statement }}</strong>
              <p>{{ evidence.rationale }}</p>
              <dl v-if="evidence.applicability || evidence.limitations" class="evidence-meta">
                <div v-if="evidence.applicability">
                  <dt>{{ t("knowledgeApplicability") }}</dt>
                  <dd>{{ evidence.applicability }}</dd>
                </div>
                <div v-if="evidence.limitations">
                  <dt>{{ t("knowledgeLimitations") }}</dt>
                  <dd>{{ evidence.limitations }}</dd>
                </div>
              </dl>
            </li>
          </ul>
          <p v-else class="muted">{{ t("knowledgeNoEvidence") }}</p>
        </div>
      </details>
    </template>
  </aside>
</template>

<style scoped>
.inspector {
  min-width: 0;
  overflow-y: auto;
  padding: 18px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--surface);
}
header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--line);
}
h2 {
  margin: 0;
  font-size: 19px;
  line-height: 1.4;
}
h3 {
  margin: 0 0 9px;
  font-size: 13px;
}
.summary {
  margin: 16px 0;
  line-height: 1.65;
}
.audit-meta {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  margin: 0 0 14px;
  background: var(--line);
}
.audit-meta div {
  min-width: 0;
  padding: 9px;
  background: var(--surface-soft);
}
dt {
  color: var(--muted);
  font-size: 11px;
}
dd {
  margin: 4px 0 0;
  overflow-wrap: anywhere;
  font-size: 12px;
  font-weight: 650;
}
.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.inspector-section {
  margin-top: 18px;
  padding-top: 15px;
  border-top: 1px solid var(--line);
}
ul {
  margin: 0;
  padding-left: 19px;
}
li {
  overflow-wrap: anywhere;
  line-height: 1.55;
}
li + li {
  margin-top: 6px;
}
.relation-list {
  display: grid;
  gap: 7px;
  padding: 0;
  list-style: none;
}
.relation-list li {
  min-width: 0;
}
.evidence-list {
  display: grid;
  gap: 10px;
  padding: 0;
  list-style: none;
}
.evidence-list li {
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius-control);
  background: var(--surface-soft);
}
.evidence-list p {
  margin: 6px 0 0;
}
.evidence-meta {
  display: grid;
  gap: 6px;
  margin: 10px 0 0;
}
.evidence-meta div {
  padding: 0;
  background: transparent;
}
.relation-button {
  display: grid;
  grid-template-columns: 18px auto minmax(0, 1fr);
  gap: 6px;
  align-items: baseline;
  width: 100%;
  padding: 8px 9px;
  border: 1px solid var(--line);
  border-radius: var(--radius-control);
  color: inherit;
  background: var(--surface-soft);
  text-align: left;
  font: inherit;
  cursor: pointer;
}
.relation-button:focus-visible {
  border-color: var(--accent);
}
.relation-button:disabled {
  cursor: default;
  opacity: 0.72;
}
.relation-list small {
  color: var(--muted);
  overflow-wrap: anywhere;
  line-height: 1.5;
}
.warnings {
  color: var(--color-warning);
}
.warnings li {
  display: grid;
  gap: 2px;
}
.inspector-disclosure {
  padding-bottom: 2px;
}
.inspector-disclosure summary {
  cursor: pointer;
  font-size: 13px;
  font-weight: 700;
}
.inspector-disclosure summary:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}
.disclosure-content {
  margin-top: 12px;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.markdown-body :deep(h1),
.markdown-body :deep(h2) {
  font-size: 16px;
}
@media (hover: hover) and (pointer: fine) {
  .relation-button:hover:not(:disabled) {
    border-color: var(--accent);
  }
}
@media (max-width: 900px) {
  .inspector {
    overflow: visible;
  }
}
</style>
