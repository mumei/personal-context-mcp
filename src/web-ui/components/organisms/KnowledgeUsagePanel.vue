<script setup lang="ts">
import { CheckCircle2, Info, LoaderCircle } from "@lucide/vue";
import { computed } from "vue";
import { useLocale } from "#webUi/composables/useLocale";
import type { KnowledgeUsageSummary } from "#webUi/types/api";

const props = defineProps<{ usage: KnowledgeUsageSummary; loading?: boolean; error?: string }>();
const { language, t } = useLocale();

const hasInjectedKnowledge = computed(() => props.usage.injected_note_count > 0);

function formatTimestamp(value?: string): string {
  if (!value) return t("knowledgeUsageNever");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(language.value === "en" ? "en-US" : "ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
</script>

<template>
  <section class="usage-panel" :aria-label="t('knowledgeUsageTitle')">
    <details class="usage-disclosure">
      <summary class="usage-summary">
        <div class="usage-summary-title">
          <h2>{{ t("knowledgeUsageTitle") }}</h2>
          <span class="usage-verdict" :class="{ active: hasInjectedKnowledge }">
            <CheckCircle2 v-if="hasInjectedKnowledge" :size="16" aria-hidden="true" />
            <Info v-else :size="16" aria-hidden="true" />
            {{ t(hasInjectedKnowledge ? "knowledgeUsageActiveShort" : "knowledgeUsageInactiveShort") }}
          </span>
        </div>
        <dl class="usage-summary-stats">
          <div>
            <dt>{{ t("knowledgeUsageStoredNotes") }}</dt>
            <dd>{{ usage.stored_note_count }}</dd>
          </div>
          <div>
            <dt>{{ t("knowledgeUsageInjectedEvents") }}</dt>
            <dd>{{ usage.injected_event_count }}</dd>
          </div>
          <div>
            <dt>{{ t("knowledgeUsageInjectedNotes") }}</dt>
            <dd>{{ usage.injected_note_count }}</dd>
          </div>
        </dl>
        <LoaderCircle v-if="loading" class="spin" :size="18" role="status" :aria-label="t('loading')" />
      </summary>
      <div class="usage-body">
        <p>{{ t("knowledgeUsageDescription") }}</p>
        <p class="usage-status-detail" :class="{ active: hasInjectedKnowledge }">
          {{ t(hasInjectedKnowledge ? "knowledgeUsageActive" : "knowledgeUsageInactive") }}
        </p>
        <p v-if="error" class="usage-error" role="alert">{{ t("knowledgeUsageLoadFailed") }}: {{ error }}</p>
        <template v-else>
          <dl class="usage-stats accumulation-stats">
            <div>
              <dt>{{ t("knowledgeUsageStoredNotes") }}</dt>
              <dd>{{ usage.stored_note_count }}</dd>
            </div>
            <div>
              <dt>{{ t("knowledgeUsageAccumulationEvents") }}</dt>
              <dd>{{ usage.accumulation_event_count }}</dd>
            </div>
            <div>
              <dt>{{ t("knowledgeUsageAccumulatedWrites") }}</dt>
              <dd>{{ usage.accumulated_note_write_count }}</dd>
            </div>
            <div>
              <dt>{{ t("knowledgeUsageLastAccumulated") }}</dt>
              <dd class="timestamp">{{ formatTimestamp(usage.last_accumulated_at) }}</dd>
            </div>
          </dl>
          <dl class="usage-stats">
            <div>
              <dt>{{ t("knowledgeUsageInjectedEvents") }}</dt>
              <dd>{{ usage.injected_event_count }}</dd>
            </div>
            <div>
              <dt>{{ t("knowledgeUsageInjectedNotes") }}</dt>
              <dd>{{ usage.injected_note_count }}</dd>
            </div>
            <div>
              <dt>{{ t("knowledgeUsageMatchedEvents") }}</dt>
              <dd>{{ usage.matched_event_count }}</dd>
            </div>
            <div>
              <dt>{{ t("knowledgeUsageLastInjected") }}</dt>
              <dd class="timestamp">{{ formatTimestamp(usage.last_injected_at) }}</dd>
            </div>
          </dl>
          <details v-if="usage.recent_events.length" class="usage-events">
            <summary>{{ t("knowledgeUsageRecentEvents") }}</summary>
            <ol>
              <li v-for="event in usage.recent_events" :key="`${event.timestamp}-${event.workflow}`">
                <span class="event-time">{{ formatTimestamp(event.timestamp) }}</span>
                <strong>{{ event.workflow }}</strong>
                <span>{{ t(`knowledgeUsageStage_${event.stage}`) }}</span>
                <span>{{ t("knowledgeUsageNoteCount", { count: event.knowledge_ids.length }) }}</span>
                <code v-if="event.knowledge_ids.length">{{ event.knowledge_ids.join(", ") }}</code>
              </li>
            </ol>
          </details>
          <p class="usage-note">{{ t("knowledgeUsageCaveat") }}</p>
        </template>
      </div>
    </details>
  </section>
</template>

<style scoped>
.usage-panel {
  border: 1px solid var(--line);
  border-radius: var(--radius-control);
  background: var(--surface);
}
.usage-disclosure {
  display: grid;
}
.usage-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  cursor: pointer;
}
.usage-summary::-webkit-details-marker {
  display: none;
}
.usage-summary::marker {
  content: "";
}
.usage-summary::after {
  content: "⌄";
  color: var(--muted);
  font-size: 18px;
  line-height: 1;
  transition: transform var(--duration-control) var(--ease-control);
}
.usage-disclosure[open] .usage-summary::after {
  transform: rotate(180deg);
}
.usage-summary:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: -2px;
}
.usage-summary-title {
  display: grid;
  gap: 3px;
  min-width: 0;
}
.usage-summary h2 {
  margin: 0;
  font-size: 15px;
}
.usage-summary-stats {
  display: grid;
  grid-template-columns: repeat(3, auto);
  gap: 12px;
  margin: 0;
}
.usage-summary-stats div {
  display: grid;
  gap: 1px;
  white-space: nowrap;
}
.usage-summary-stats dt,
.usage-stats dt {
  color: var(--muted);
  font-size: 11px;
}
.usage-summary-stats dd {
  margin: 0;
  font-size: 14px;
  font-weight: 750;
  font-variant-numeric: tabular-nums;
}
.usage-body {
  display: grid;
  gap: 9px;
  padding: 0 12px 12px;
  border-top: 1px solid var(--line);
}
.usage-disclosure[open] .usage-body {
  max-height: min(35dvh, 340px);
  overflow-y: auto;
}
.usage-body > p,
.usage-note,
.usage-error {
  margin: 3px 0 0;
  color: var(--muted);
  font-size: 12px;
}
.usage-status-detail {
  font-weight: 700;
}
.usage-status-detail.active {
  color: var(--color-success);
}
.usage-verdict {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--muted);
  font-weight: 700;
}
.usage-verdict.active {
  color: var(--color-success);
}
.usage-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin: 0;
  border-block: 1px solid var(--line);
}
.usage-stats div {
  min-width: 0;
  padding: 9px;
}
.usage-stats div + div {
  border-left: 1px solid var(--line);
}
.usage-stats dd {
  margin: 3px 0 0;
  font-size: 18px;
  font-weight: 750;
}
.usage-stats .timestamp {
  font-size: 12px;
  font-weight: 650;
}
.usage-events summary {
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
}
.usage-events ol {
  display: grid;
  gap: 5px;
  margin: 8px 0 0;
  padding-left: 20px;
}
.usage-events li {
  display: flex;
  flex-wrap: wrap;
  gap: 5px 9px;
  align-items: baseline;
  font-size: 11px;
}
.usage-events code {
  overflow-wrap: anywhere;
}
.event-time {
  color: var(--muted);
}
.usage-error {
  color: var(--danger);
}
.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (max-width: 900px) {
  .usage-disclosure[open] .usage-body {
    max-height: none;
  }
  .usage-summary {
    align-items: start;
    flex-wrap: wrap;
  }
  .usage-summary-stats {
    width: 100%;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .usage-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .usage-stats div:nth-child(3) {
    border-left: 0;
  }
  .usage-stats div:nth-child(n + 3) {
    border-top: 1px solid var(--line);
  }
}
@media (max-width: 560px) {
  .usage-summary-stats {
    display: none;
  }
  .usage-summary {
    align-items: center;
    flex-wrap: nowrap;
  }
}
</style>
