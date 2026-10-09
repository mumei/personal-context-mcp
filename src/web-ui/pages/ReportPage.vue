<script setup lang="ts">
import { Copy, RefreshCw } from "@lucide/vue";
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { getJson, mutateJson } from "#webUi/services/api";
import type { ReportOutputs } from "#webUi/types/api";
import BaseButton from "#webUi/components/atoms/BaseButton.vue";
import EmptyState from "#webUi/components/atoms/EmptyState.vue";
import { useLocale } from "#webUi/composables/useLocale";
import { useDashboard } from "#webUi/composables/useDashboard";
const route = useRoute();
const router = useRouter();
const reports = ref<ReportOutputs>({});
const generating = ref(false);
const copied = ref(false);
const format = computed(() => (route.params.format === "markdown" ? "markdown" : "text"));
const { selectedDate, state } = useDashboard();
const date = selectedDate;
const currentReport = computed(() => reports.value[format.value]);
const pendingTasks = computed(() => reports.value.sync?.tasks ?? []);
const { t } = useLocale();
const source = computed(() => {
  const item = currentReport.value;
  return typeof item === "string" ? item : item?.text || "";
});
const renderedMarkdown = computed(() => {
  const item = currentReport.value;
  return item && typeof item === "object" && "html" in item ? item.html || "" : "";
});
async function load() {
  reports.value = await getJson(`/api/report?date=${encodeURIComponent(date.value)}`);
}
async function generate() {
  generating.value = true;
  state.error = "";
  try {
    const result = await mutateJson<{ output: Record<string, unknown>; sync: ReportOutputs["sync"] }>(
      "/api/report/generate",
      "POST",
      { date: date.value, format: format.value },
    );
    reports.value = { ...reports.value, sync: result.sync, [format.value]: result.output };
    state.notice = t("reportUpdated");
  } catch (error) {
    state.error = `${t("reportUpdateFailed")}: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    generating.value = false;
  }
}
async function copy() {
  await window.navigator.clipboard.writeText(source.value);
  copied.value = true;
  window.setTimeout(() => (copied.value = false), 1500);
}
onMounted(load);
watch(() => [format.value, date.value], load);
</script>
<template>
  <div class="stack">
    <div class="page-heading">
      <div>
        <h2>{{ t("dailyReport") }}</h2>
        <p>{{ date }}</p>
      </div>
      <nav class="report-navigation" :aria-label="t('report')">
        <RouterLink :to="{ path: '/report/text', query: route.query }">{{ t("dailyReport") }}</RouterLink>
        <RouterLink to="/report/weekly/text">{{ t("weeklyReport") }}</RouterLink>
      </nav>
    </div>
    <div class="report surface">
      <div class="sync-status" :class="{ current: pendingTasks.length === 0 }">
        <div>
          <strong>{{ pendingTasks.length ? t("reportPendingTitle") : t("reportCurrentTitle") }}</strong>
          <p>{{ pendingTasks.length ? t("reportPendingDescription") : t("reportCurrentDescription") }}</p>
        </div>
        <span class="sync-count">{{ pendingTasks.length }}</span>
      </div>
      <ul v-if="pendingTasks.length" class="pending-list">
        <li v-for="task in pendingTasks" :key="task.task_id">
          <span>
            <strong>{{ task.title }}</strong>
            <small>{{ task.pending_activity_count }} {{ t("reportPendingActivities") }}</small>
          </span>
          <span v-if="task.manual_override" class="override-label">{{ t("reportManualOverride") }}</span>
        </li>
      </ul>
      <div class="tabs">
        <button
          :class="{ active: format === 'text' }"
          @click="router.push({ params: { format: 'text' }, query: route.query })"
        >
          Text</button
        ><button
          :class="{ active: format === 'markdown' }"
          @click="router.push({ params: { format: 'markdown' }, query: route.query })"
        >
          Markdown
        </button>
      </div>
      <div class="toolbar">
        <BaseButton :disabled="generating || pendingTasks.length === 0" variant="primary" @click="generate"
          ><RefreshCw :size="16" />{{ generating ? t("generating") : t("reportUpdatePending") }}</BaseButton
        ><BaseButton :disabled="!source" @click="copy"
          ><Copy :size="16" />{{ copied ? t("copied") : t("copy") }}</BaseButton
        >
      </div>
      <article v-if="format === 'markdown' && renderedMarkdown" class="markdown-body" v-html="renderedMarkdown" />
      <pre v-else-if="source">{{ source }}</pre>
      <EmptyState v-else :message="t(format === 'markdown' ? 'reportEmptyMarkdown' : 'reportEmptyText')" />
    </div>
  </div>
</template>
<style scoped>
.report {
  overflow: hidden;
}
.report-navigation {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
}
.report-navigation a {
  color: var(--accent);
}
.tabs {
  display: flex;
  border-bottom: 1px solid var(--line);
}
.sync-status {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--line);
  background: var(--color-warning-soft);
}
.sync-status.current {
  background: var(--color-success-soft);
}
.sync-status p {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 13px;
}
.sync-count {
  display: grid;
  flex: 0 0 34px;
  width: 34px;
  height: 34px;
  place-items: center;
  border: 1px solid var(--color-rule-strong);
  border-radius: var(--radius-control);
  background: color-mix(in oklch, var(--surface) 76%, transparent);
  font-weight: 800;
}
.pending-list {
  display: grid;
  gap: 0;
  margin: 0;
  padding: 0;
  list-style: none;
  border-bottom: 1px solid var(--line);
}
.pending-list li {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 20px;
  border-top: 1px solid var(--line);
}
.pending-list small {
  display: block;
  margin-top: 3px;
  color: var(--muted);
}
.override-label {
  align-self: center;
  color: var(--muted);
  font-size: 12px;
  white-space: nowrap;
}
.tabs button {
  min-width: 130px;
  padding: 12px;
  border: 0;
  border-bottom: 3px solid transparent;
  background: transparent;
}
.tabs button.active {
  border-color: var(--accent);
  font-weight: 700;
}
.toolbar {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px;
  border-bottom: 1px solid var(--line);
}
.toolbar :deep(button) {
  display: flex;
  align-items: center;
  gap: 6px;
}
pre,
.markdown-body {
  min-height: 420px;
  margin: 0;
  padding: 20px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: inherit;
  line-height: 1.7;
}
pre {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
}
.markdown-body {
  white-space: normal;
}
</style>
