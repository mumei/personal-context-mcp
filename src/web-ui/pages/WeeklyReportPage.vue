<script setup lang="ts">
import { Copy, RefreshCw } from "@lucide/vue";
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useLocale } from "#webUi/composables/useLocale";
import { useWeeklyReport } from "#webUi/composables/useWeeklyReport";
import BaseButton from "#webUi/components/atoms/BaseButton.vue";
import EmptyState from "#webUi/components/atoms/EmptyState.vue";

const route = useRoute();
const router = useRouter();
const { t, language } = useLocale();
const {
  report,
  history,
  periods,
  versions,
  canGenerate,
  week,
  through,
  loading,
  generating,
  error,
  format,
  maxThrough,
  rangeLabel,
  currentText,
  markdownHtml,
  setWeek,
  setThrough,
  generate,
} = useWeeklyReport();
const copied = ref(false);
const partialThrough = ref("");
function periodLabel(start: string, end: string): string {
  const saved = versionsForPeriod(start, end);
  return `${start} 〜 ${end} · ${t(saved ? "weeklyReportSaved" : "weeklyReportNotGenerated")}`;
}
function versionsForPeriod(start: string, end: string): boolean {
  return history.value?.versions.some((item) => item.week_start === start && item.week_end === end) ?? false;
}
const generationTime = computed(() => {
  if (!report.value?.generated_at) return "";
  try {
    return new Intl.DateTimeFormat(language.value, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: report.value.timezone,
    }).format(new Date(report.value.generated_at));
  } catch {
    return report.value.generated_at;
  }
});
const isEmpty = computed(() => !report.value?.exists || !currentText.value);

function setFormat(value: "text" | "markdown"): void {
  void router.push({ name: "weekly-report", params: { format: value }, query: route.query });
}

async function copy(): Promise<void> {
  await window.navigator.clipboard.writeText(currentText.value);
  copied.value = true;
  window.setTimeout(() => (copied.value = false), 1500);
}
</script>

<template>
  <div class="stack weekly-report-page">
    <div class="page-heading">
      <div>
        <h2>{{ t("weeklyReport") }}</h2>
        <p v-if="rangeLabel">
          {{ t("weeklyReportPeriod", { start: report?.week_start ?? "", end: report?.week_end ?? "" }) }}
        </p>
      </div>
      <div class="range-controls">
        <label>
          <span>{{ t("weeklyReportSelectWeek") }}</span>
          <select :value="week" @change="setWeek(($event.target as HTMLSelectElement).value)">
            <option v-for="period in periods" :key="period.week_start" :value="period.week_start">
              {{ periodLabel(period.week_start, period.week_end) }}
            </option>
          </select>
        </label>
        <label v-if="versions.length">
          <span>{{ t("weeklyReportVersions") }}</span>
          <select :value="through" :disabled="loading" @change="setThrough(($event.target as HTMLSelectElement).value)">
            <option v-for="version in versions" :key="version.through" :value="version.through">
              {{ version.through }} · {{ t(version.provisional ? "weeklyReportProvisional" : "weeklyReportFinal") }}
            </option>
          </select>
        </label>
      </div>
    </div>

    <div v-if="error" class="weekly-error" role="alert">{{ t("weeklyReportLoadFailed") }}: {{ error }}</div>

    <section class="report surface" aria-label="Weekly report">
      <div v-if="report" class="report-meta">
        <div class="meta-dates">
          <span
            ><strong>{{ t("weeklyReportPeriodLabel") }}</strong
            >{{ rangeLabel }}</span
          >
          <span
            ><strong>{{ t("weeklyReportThroughLabel") }}</strong
            >{{ report.through }}</span
          >
        </div>
        <div class="meta-status">
          <span v-if="!report.exists">{{ t("weeklyReportNotGenerated") }}</span>
          <span v-else-if="report.provisional" class="provisional">{{ t("weeklyReportProvisional") }}</span>
          <span v-else>{{ t("weeklyReportFinal") }}</span>
          <span v-if="generationTime">{{
            t("weeklyReportGeneratedAt", { time: generationTime, timezone: report.timezone })
          }}</span>
        </div>
      </div>
      <div class="tabs" role="tablist" :aria-label="t('weeklyReportFormats')">
        <button
          type="button"
          role="tab"
          :aria-selected="format === 'text'"
          :class="{ active: format === 'text' }"
          @click="setFormat('text')"
        >
          Text
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="format === 'markdown'"
          :class="{ active: format === 'markdown' }"
          @click="setFormat('markdown')"
        >
          Markdown
        </button>
      </div>
      <div class="toolbar">
        <BaseButton
          :disabled="!report || !canGenerate || generating || loading"
          :title="t('weeklyReportGenerateThrough', { date: maxThrough })"
          variant="primary"
          @click="generate()"
        >
          <RefreshCw :size="16" />{{ generating ? t("generating") : t("weeklyReportGenerate") }}
        </BaseButton>
        <BaseButton :disabled="isEmpty" @click="copy">
          <Copy :size="16" />{{ copied ? t("copied") : t("copy") }}
        </BaseButton>
      </div>
      <details v-if="report && canGenerate" class="partial-controls">
        <summary>{{ t("weeklyReportPartialGenerate") }}</summary>
        <label
          >{{ t("weeklyReportThrough") }}
          <input v-model="partialThrough" type="date" :min="report.week_start" :max="maxThrough" />
        </label>
        <BaseButton
          :disabled="
            generating ||
            loading ||
            !partialThrough ||
            partialThrough < report.week_start ||
            partialThrough > maxThrough
          "
          @click="generate(partialThrough)"
        >
          {{ t("weeklyReportPartialGenerate") }}
        </BaseButton>
      </details>
      <p v-if="report" class="boundary-note">
        {{ t("weeklyReportBoundary", { timezone: report.timezone, hour: report.rollover_hour }) }}
      </p>
      <p v-if="report && !canGenerate" class="boundary-note">{{ t("weeklyReportHistoricalReadonly") }}</p>
      <div v-if="loading && !report" class="report-loading" role="status">{{ t("loading") }}</div>
      <article v-else-if="format === 'markdown' && !isEmpty" class="markdown-body" v-html="markdownHtml" />
      <pre v-else-if="!isEmpty">{{ currentText }}</pre>
      <EmptyState v-else :message="t(format === 'markdown' ? 'weeklyReportEmptyMarkdown' : 'weeklyReportEmptyText')" />
    </section>
  </div>
</template>

<style scoped>
.report {
  overflow: hidden;
}
.range-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.range-controls label {
  display: grid;
  gap: 5px;
  color: var(--muted);
  font-size: 12px;
}
.range-controls input,
.range-controls select {
  min-height: 38px;
  max-width: 100%;
  padding: 6px 9px;
  border: 1px solid var(--line);
  border-radius: var(--radius-control);
  background: var(--surface);
  color: var(--text);
  font: inherit;
}
.range-controls {
  align-items: end;
}
.partial-controls,
.boundary-note {
  margin: 12px 16px;
  color: var(--muted);
  font-size: 13px;
}
.partial-controls label {
  display: inline-flex;
  gap: 8px;
  margin: 12px;
}
.report-meta {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 10px 20px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--line);
  color: var(--muted);
  font-size: 13px;
}
.meta-dates,
.meta-status {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 18px;
}
.report-meta strong {
  margin-right: 6px;
  color: var(--text);
}
.provisional {
  color: var(--color-warning-text, #8a4b08);
  font-weight: 700;
}
.tabs {
  display: flex;
  border-bottom: 1px solid var(--line);
}
.tabs button {
  min-width: 110px;
  min-height: 42px;
  padding: 10px 14px;
  border: 0;
  border-bottom: 3px solid transparent;
  background: transparent;
  color: var(--text);
}
.tabs button.active {
  border-color: var(--accent);
  font-weight: 700;
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
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
.report-loading {
  min-height: 180px;
  display: grid;
  place-items: center;
  color: var(--muted);
}
pre,
.markdown-body {
  min-height: 360px;
  margin: 0;
  padding: 18px;
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
.weekly-error {
  padding: 10px 12px;
  border-left: 3px solid var(--color-danger, #b42318);
  background: var(--color-danger-soft, #fff1f0);
  color: var(--color-danger-text, #8a1c13);
}
@media (max-width: 640px) {
  .range-controls {
    width: 100%;
  }
  .range-controls label {
    flex: 1 1 140px;
  }
  .range-controls input {
    width: 100%;
  }
  .report-meta {
    display: grid;
  }
}
</style>
