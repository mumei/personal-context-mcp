<script setup lang="ts">
import { Search, X } from "@lucide/vue";
import BaseButton from "#webUi/components/atoms/BaseButton.vue";
import { useLocale } from "#webUi/composables/useLocale";

const props = defineProps<{
  types: string[];
  tags: string[];
  loading?: boolean;
  dirty?: boolean;
  hasActiveFilters?: boolean;
}>();
const query = defineModel<string>("query", { required: true });
const type = defineModel<string>("type", { required: true });
const tag = defineModel<string>("tag", { required: true });
const orphanOnly = defineModel<boolean>("orphanOnly", { required: true });
defineEmits<{ apply: []; clear: [] }>();
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
</script>

<template>
  <form class="filters" role="search" :aria-busy="loading" @submit.prevent="$emit('apply')">
    <label class="search-field">
      <span>{{ t("knowledgeSearch") }}</span>
      <span class="input-wrap">
        <Search :size="17" aria-hidden="true" />
        <input v-model="query" type="search" :placeholder="t('knowledgeSearchPlaceholder')" />
      </span>
    </label>
    <label>
      <span>{{ t("knowledgeType") }}</span>
      <select v-model="type">
        <option value="">{{ t("knowledgeAllTypes") }}</option>
        <option v-for="item in types" :key="item" :value="item">{{ typeLabel(item) }}</option>
      </select>
    </label>
    <label>
      <span>{{ t("knowledgeTag") }}</span>
      <input
        v-model="tag"
        type="text"
        list="knowledge-tag-options"
        autocomplete="off"
        :placeholder="t('knowledgeTagPlaceholder')"
      />
      <datalist id="knowledge-tag-options">
        <option v-for="item in tags" :key="item" :value="item" />
      </datalist>
    </label>
    <label class="orphan-toggle"><input v-model="orphanOnly" type="checkbox" />{{ t("knowledgeOrphansOnly") }}</label>
    <div class="actions">
      <BaseButton variant="primary" :disabled="loading || !props.dirty"
        ><Search :size="16" />{{ t("knowledgeApplyFilters") }}</BaseButton
      >
      <BaseButton
        type="button"
        variant="ghost"
        :disabled="loading || (!props.dirty && !props.hasActiveFilters)"
        @click="$emit('clear')"
        ><X :size="16" />{{ t("knowledgeClearFilters") }}</BaseButton
      >
    </div>
  </form>
</template>

<style scoped>
.filters {
  display: grid;
  grid-template-columns: minmax(240px, 1.55fr) minmax(132px, 0.55fr) minmax(170px, 0.75fr) auto auto;
  align-items: end;
  gap: var(--space-2xs);
  padding: var(--space-xs);
  border: 1px solid var(--line);
  border-radius: var(--radius-surface);
  background: var(--surface);
}
label {
  display: grid;
  gap: var(--space-3xs);
  color: var(--muted);
  font-size: var(--text-xs);
  font-weight: 650;
}
input[type="search"],
input[type="text"],
select {
  width: 100%;
  min-height: var(--control-height);
  border: 1px solid var(--line);
  border-radius: var(--radius-control);
  color: var(--color-ink);
  background: var(--color-paper);
}
input[type="search"] {
  min-width: 0;
  padding: var(--space-2xs) var(--space-xs) var(--space-2xs) var(--space-lg);
}
input[type="text"],
select {
  padding: var(--space-2xs) var(--space-xs);
}
input::placeholder {
  color: var(--muted);
}
.input-wrap {
  position: relative;
}
.input-wrap svg {
  position: absolute;
  z-index: 1;
  top: 50%;
  inset-inline-start: var(--space-xs);
  color: var(--muted);
  transform: translateY(-50%);
  pointer-events: none;
}
.orphan-toggle {
  display: flex;
  min-height: var(--control-height);
  align-items: center;
  gap: var(--space-2xs);
  padding-inline: var(--space-3xs);
  color: var(--text);
  white-space: nowrap;
}
.orphan-toggle input {
  width: 18px;
  height: 18px;
  accent-color: var(--accent);
}
.actions {
  display: flex;
  gap: var(--space-3xs);
}
.actions :deep(button) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
@media (hover: hover) and (pointer: fine) {
  input:hover,
  select:hover {
    background: var(--color-paper-2);
  }
}
@container knowledge-controls (max-width: 56rem) {
  .filters {
    grid-template-columns: minmax(220px, 1fr) repeat(2, minmax(140px, 0.5fr));
  }
  .actions {
    justify-content: flex-end;
    grid-column: 2 / -1;
  }
}
@container knowledge-controls (max-width: 34rem) {
  .filters {
    grid-template-columns: 1fr 1fr;
  }
  .search-field,
  .actions {
    grid-column: 1 / -1;
  }
  .actions {
    justify-content: stretch;
  }
  .actions :deep(button) {
    flex: 1;
    justify-content: center;
  }
}
@container knowledge-controls (max-width: 28rem) {
  .filters {
    grid-template-columns: minmax(0, 1fr);
  }
  .search-field,
  .actions {
    grid-column: auto;
  }
  .orphan-toggle {
    min-height: 44px;
  }
}
</style>
