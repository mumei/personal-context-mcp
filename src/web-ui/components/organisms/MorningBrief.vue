<script setup lang="ts">
import { ChevronDown, ListChecks } from "@lucide/vue";
import type { MorningBriefSection } from "#webUi/types/api";
import BaseButton from "#webUi/components/atoms/BaseButton.vue";
import EmptyState from "#webUi/components/atoms/EmptyState.vue";
import { useLocale } from "#webUi/composables/useLocale";
interface TaskProgress {
  alignment_state?: unknown;
  assessment?: unknown;
}
const props = defineProps<{
  sections?: MorningBriefSection[];
  progress?: Record<string, TaskProgress>;
  date?: string;
  checking?: boolean;
  canCheckProgress?: boolean;
}>();
const emit = defineEmits<{ checkProgress: [] }>();
const { t } = useLocale();
const sectionKeys = [
  "briefSchedule",
  "briefUnreadMail",
  "briefGithub",
  "briefAttention",
  "briefTaskTable",
  "briefRecommendation",
] as const;
const tableHeaderKeys = ["priority", "taskName", "todayAction", "todayGoal"] as const;
function sectionTitle(number: number, fallback: string): string {
  return sectionKeys[number - 1] ? t(sectionKeys[number - 1]) : fallback;
}
function tableHeader(index: number, fallback: string): string {
  return tableHeaderKeys[index] ? t(tableHeaderKeys[index]) : fallback;
}
function sectionPreview(section: MorningBriefSection): string {
  return section.preview ?? section.items[0] ?? section.paragraphs[0] ?? t("briefMissingSection");
}
function taskIdFromRow(row: string[]): string | undefined {
  const encoded = row.join(" ").match(/<!--task-id:([^>]+)-->/)?.[1];
  if (!encoded) return undefined;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return undefined;
  }
}
function rowProgress(row: string[]): TaskProgress | undefined {
  const taskId = taskIdFromRow(row);
  return taskId ? props.progress?.[taskId] : undefined;
}
function progressComment(row: string[]): string | undefined {
  const assessment = rowProgress(row)?.assessment;
  return typeof assessment === "string" && assessment.trim() ? assessment.trim() : undefined;
}
function cleanCell(cell: string): string {
  return cell.replace(/<!--task-id:[^>]+-->/g, "").trim();
}
function taskHref(row: string[]): string {
  const taskId = taskIdFromRow(row);
  if (!taskId) return "";
  const query = props.date ? "?date=" + encodeURIComponent(props.date) : "";
  return "/tasks/" + encodeURIComponent(taskId) + "/current" + query;
}
function emptySectionMessage(section: MorningBriefSection): string | undefined {
  if (!section.available) return undefined;
  if (section.number === 4 && !section.items.length && !section.paragraphs.length) return t("briefNoAttention");
  if (section.number === 5 && !section.table?.rows.length) return t("briefNoTasks");
  return undefined;
}
function progressLabel(value: unknown): string {
  const keys = {
    not_started: "notStarted",
    in_progress: "progressing",
    aligned: "aligned",
    completed: "completed",
    waiting: "waiting",
    blocked: "blocked",
  } as const;
  return typeof value === "string" && value in keys ? t(keys[value as keyof typeof keys]) : t("progressUnchecked");
}
</script>
<template>
  <div v-if="sections?.length" class="brief-grid">
    <template v-for="section in sections" :key="section.number">
      <details v-if="section.number === 3" class="brief brief-accordion surface">
        <summary>
          <span class="number">{{ section.number }}</span>
          <span class="accordion-heading">
            <span class="accordion-title">{{ sectionTitle(section.number, section.title) }}</span>
            <span class="accordion-preview">{{ sectionPreview(section) }}</span>
          </span>
          <ChevronDown class="accordion-chevron" :size="20" aria-hidden="true" />
        </summary>
        <div class="accordion-content">
          <EmptyState v-if="!section.available" :message="t('briefMissingSection')" />
          <ul v-else-if="section.items?.length" class="value-list">
            <li v-for="item in section.items" :key="item">{{ item }}</li>
          </ul>
          <p v-for="paragraph in section.paragraphs" :key="paragraph">{{ paragraph }}</p>
        </div>
      </details>
      <section v-else class="brief surface" :class="{ wide: section.number >= 4 }">
        <div class="brief-heading">
          <div class="number">{{ section.number }}</div>
          <h3>{{ sectionTitle(section.number, section.title) }}</h3>
          <BaseButton
            v-if="section.number === 5"
            type="button"
            :disabled="!canCheckProgress || checking"
            @click="emit('checkProgress')"
          >
            <ListChecks :size="16" />{{ checking ? t("progressChecking") : t("progressCheck") }}
          </BaseButton>
        </div>
        <EmptyState v-if="!section.available" :message="t('briefMissingSection')" />
        <ul v-else-if="section.items?.length" class="value-list">
          <li v-for="item in section.items" :key="item">{{ item }}</li>
        </ul>
        <p v-for="paragraph in section.paragraphs" :key="paragraph">{{ paragraph }}</p>
        <EmptyState v-if="emptySectionMessage(section)" :message="emptySectionMessage(section) ?? ''" />
        <div v-if="section.table?.rows?.length" class="table-wrap">
          <table>
            <thead>
              <tr>
                <th v-for="(header, index) in section.table.headers" :key="header">
                  {{ tableHeader(index, header) }}
                </th>
                <th>{{ t("progress") }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, index) in section.table.rows" :key="index">
                <td v-for="(cell, cellIndex) in row" :key="cellIndex">
                  <RouterLink v-if="cellIndex === 1 && taskHref(row)" :to="taskHref(row)">{{
                    cleanCell(cell)
                  }}</RouterLink>
                  <template v-else>{{ cleanCell(cell) }}</template>
                </td>
                <td>
                  <div class="progress-cell">
                    <span class="progress">{{ progressLabel(rowProgress(row)?.alignment_state) }}</span>
                    <p v-if="progressComment(row)" class="progress-comment">{{ progressComment(row) }}</p>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
  <EmptyState v-else :message="t('briefEmpty')" />
</template>
<style scoped>
.brief-grid {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: var(--space-sm);
}
.brief {
  position: relative;
  grid-column: span 6;
  padding: var(--space-md);
  overflow: hidden;
}
.brief.wide {
  grid-column: 1 / -1;
}
.number {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border-radius: var(--radius-control);
  color: var(--color-on-accent);
  background: var(--accent);
  font-weight: 800;
}
.brief-heading {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}
.brief-heading h3 {
  margin: 0;
  font-size: 16px;
}
.brief-heading :deep(button) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.brief p {
  line-height: 1.7;
}
.brief-accordion {
  align-self: start;
  grid-column: 1 / -1;
}
.brief-accordion summary {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) 20px;
  gap: 12px;
  align-items: center;
  cursor: pointer;
  list-style: none;
}
.brief-accordion summary::-webkit-details-marker {
  display: none;
}
.accordion-heading {
  min-width: 0;
}
.accordion-title,
.accordion-preview {
  display: block;
}
.accordion-title {
  font-size: 16px;
  font-weight: 700;
}
.accordion-preview {
  margin-top: 4px;
  overflow: hidden;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.5;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.accordion-chevron {
  color: var(--muted);
  transition: transform var(--duration-control) var(--ease-control);
}
.brief-accordion[open] .accordion-chevron {
  transform: rotate(180deg);
}
.brief-accordion[open] {
  grid-column: 1 / -1;
}
.brief-accordion[open] .accordion-preview {
  display: none;
}
.accordion-content {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--line);
}
.accordion-content .value-list {
  margin-bottom: 0;
}
.table-wrap {
  overflow: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  min-width: 680px;
}
th,
td {
  padding: 10px;
  border-bottom: 1px solid var(--line);
  text-align: left;
  vertical-align: top;
}
th {
  color: var(--muted);
  background: var(--surface-soft);
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}
.progress {
  white-space: nowrap;
  font-size: 12px;
  font-weight: 700;
}
.progress-cell {
  min-width: 180px;
}
.progress-comment {
  margin: 5px 0 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.55;
}
td a {
  font-weight: 700;
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;
}
@media (max-width: 1050px) {
  .brief-grid {
    grid-template-columns: 1fr;
  }
  .brief,
  .brief-accordion,
  .brief.wide {
    grid-column: 1;
  }
}
@media (max-width: 560px) {
  .brief-heading {
    grid-template-columns: 28px minmax(0, 1fr);
  }
  .brief-heading :deep(button) {
    grid-column: 1 / -1;
    justify-content: center;
    width: 100%;
  }
}
</style>
