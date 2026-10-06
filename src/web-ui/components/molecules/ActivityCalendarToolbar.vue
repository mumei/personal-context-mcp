<script setup lang="ts">
import { ChevronLeft, ChevronRight, RotateCw } from "@lucide/vue";
import BaseButton from "#webUi/components/atoms/BaseButton.vue";
import type { ActivityCalendarViewMode } from "#webUi/composables/activity/calendarMath";
import { useLocale } from "#webUi/composables/useLocale";

defineProps<{
  label: string;
  view: ActivityCalendarViewMode;
  projects: string[];
  selectedProjects: string[];
  loading: boolean;
}>();
defineEmits<{
  previous: [];
  next: [];
  today: [];
  reload: [];
  "update:view": [view: ActivityCalendarViewMode];
  "toggle-project": [project: string];
}>();
const { t } = useLocale();
const views: ActivityCalendarViewMode[] = ["month", "week", "day", "lane"];
</script>

<template>
  <div class="calendar-toolbar">
    <div class="date-navigation">
      <BaseButton :title="t('previousPeriod')" @click="$emit('previous')"><ChevronLeft :size="17" /></BaseButton>
      <BaseButton @click="$emit('today')">{{ t("today") }}</BaseButton>
      <BaseButton :title="t('nextPeriod')" @click="$emit('next')"><ChevronRight :size="17" /></BaseButton>
      <h2>{{ label }}</h2>
    </div>
    <div class="view-actions">
      <div class="view-switch" :aria-label="t('activityView')">
        <button
          v-for="mode in views"
          :key="mode"
          type="button"
          :class="{ active: view === mode }"
          @click="$emit('update:view', mode)"
        >
          {{ t(`activityView_${mode}` as never) }}
        </button>
      </div>
      <BaseButton :disabled="loading" :title="t('reload')" @click="$emit('reload')"><RotateCw :size="17" /></BaseButton>
    </div>
    <fieldset v-if="projects.length" class="project-filters">
      <legend>{{ t("activityProjects") }}</legend>
      <label v-for="(project, index) in projects" :key="project">
        <input
          type="checkbox"
          :checked="selectedProjects.includes(project)"
          @change="$emit('toggle-project', project)"
        />
        <i :class="`project-${(index % 6) + 1}`" />
        <span>{{ project }}</span>
      </label>
    </fieldset>
  </div>
</template>

<style scoped>
.calendar-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-xs);
  padding: var(--space-xs);
  border: 1px solid var(--color-rule);
  border-radius: var(--radius-surface);
  background: var(--color-paper);
}
.date-navigation,
.view-actions,
.view-switch,
.project-filters,
.project-filters label {
  display: flex;
  align-items: center;
}
.date-navigation,
.view-actions {
  gap: var(--space-2xs);
}
.date-navigation h2 {
  min-width: 0;
  margin: 0 0 0 var(--space-2xs);
  overflow-wrap: anywhere;
  font-size: var(--text-lg);
}
.date-navigation :deep(.button),
.view-actions :deep(.button) {
  display: inline-grid;
  min-width: var(--control-height);
  place-items: center;
}
.view-switch {
  min-height: var(--control-height);
  border: 1px solid var(--color-rule);
  border-radius: var(--radius-control);
  background: var(--color-paper);
}
.view-switch button {
  min-height: calc(var(--control-height) - 2px);
  padding: 0 var(--space-xs);
  border: 0;
  border-right: 1px solid var(--color-rule);
  color: var(--color-ink-2);
  background: transparent;
  font-weight: 650;
  white-space: nowrap;
}
.view-switch button:last-child {
  border-right: 0;
}
.view-switch button.active {
  color: var(--color-on-accent);
  background: var(--color-accent);
}
.project-filters {
  grid-column: 1 / -1;
  flex-wrap: wrap;
  gap: 6px var(--space-xs);
  margin: 0;
  padding: var(--space-2xs) 0 0;
  border: 0;
  border-top: 1px solid var(--color-rule);
}
.project-filters legend {
  float: left;
  margin-right: var(--space-xs);
  color: var(--color-ink-2);
  font-size: var(--text-xs);
  font-weight: 700;
}
.project-filters label {
  gap: 5px;
  min-height: 28px;
  font-size: var(--text-xs);
  white-space: nowrap;
}
.project-filters input {
  width: 16px;
  height: 16px;
}
.project-filters i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-project-1);
}
.project-filters i.project-2 {
  background: var(--color-project-2);
}
.project-filters i.project-3 {
  background: var(--color-project-3);
}
.project-filters i.project-4 {
  background: var(--color-project-4);
}
.project-filters i.project-5 {
  background: var(--color-project-5);
}
.project-filters i.project-6 {
  background: var(--color-project-6);
}
@media (max-width: 760px) {
  .calendar-toolbar {
    grid-template-columns: minmax(0, 1fr);
  }
  .date-navigation {
    display: grid;
    grid-template-columns: var(--control-height) auto var(--control-height) minmax(0, 1fr);
  }
  .date-navigation h2 {
    font-size: var(--text-md);
  }
  .view-actions {
    justify-content: space-between;
  }
  .view-switch {
    overflow-x: auto;
  }
  .view-switch button {
    padding-inline: 10px;
  }
}
@media (max-width: 430px) {
  .date-navigation h2 {
    grid-column: 1 / -1;
    grid-row: 1;
    margin: 0 0 var(--space-3xs);
    white-space: nowrap;
  }
  .date-navigation :deep(.button) {
    grid-row: 2;
  }
}
</style>
