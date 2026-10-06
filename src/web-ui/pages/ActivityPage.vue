<!-- Hallmark · genre: modern-minimal · macrostructure: Workbench · theme: Personal Context MCP Teal Instrument
     designed-as-app · audience: owner · job: audit work over time · tone: utilitarian
     pre-emit critique: P5 H4 E5 S5 R5 V4 · contrast: pass · slop: pass · responsive: pass -->
<script setup lang="ts">
import { CalendarClock } from "@lucide/vue";
import { computed } from "vue";
import ActivityCalendarToolbar from "#webUi/components/molecules/ActivityCalendarToolbar.vue";
import ActivityInspector from "#webUi/components/organisms/ActivityInspector.vue";
import ActivityMonthGrid from "#webUi/components/organisms/ActivityMonthGrid.vue";
import ActivityProjectLanes from "#webUi/components/organisms/ActivityProjectLanes.vue";
import ActivityTimeGrid from "#webUi/components/organisms/ActivityTimeGrid.vue";
import { calendarLabel } from "#webUi/composables/activity/calendarMath";
import { useActivityCalendar } from "#webUi/composables/activity/useActivityCalendar";
import { useDashboard } from "#webUi/composables/useDashboard";
import { useLocale } from "#webUi/composables/useLocale";

const { state } = useDashboard();
const { language, t } = useLocale();
const calendar = useActivityCalendar(() => state.overview?.today ?? "");
const locale = computed(() => (language.value === "en" ? "en-US" : "ja-JP"));
const label = computed(() => calendarLabel(calendar.focusDate.value, calendar.view.value, locale.value));
const eventCount = computed(() => calendar.events.value.length);
</script>

<template>
  <div class="activity-page">
    <ActivityCalendarToolbar
      :label="label"
      :view="calendar.view.value"
      :projects="calendar.response.value.projects"
      :selected-projects="calendar.selectedProjects.value"
      :loading="calendar.loading.value"
      @previous="calendar.move(-1)"
      @next="calendar.move(1)"
      @today="calendar.goToday"
      @reload="calendar.load"
      @update:view="calendar.setView"
      @toggle-project="calendar.toggleProject"
    />
    <div class="calendar-status">
      <span><CalendarClock :size="15" />{{ t("activityCount", { count: eventCount }) }}</span>
      <span
        >{{ calendar.response.value.timezone }} · {{ t("activityRollover") }}
        {{ calendar.response.value.rollover_hour }}:00</span
      >
    </div>
    <p v-if="calendar.error.value" class="activity-error" role="alert">
      {{ t("activityLoadFailed") }}: {{ calendar.error.value }}
    </p>
    <div v-else class="activity-workspace" :class="{ inspecting: calendar.selected.value }">
      <div class="calendar-surface">
        <div v-if="calendar.loading.value && !calendar.response.value.events.length" class="loading-state">
          <CalendarClock :size="22" />{{ t("loading") }}
        </div>
        <ActivityMonthGrid
          v-else-if="calendar.view.value === 'month'"
          :from="calendar.range.value.from"
          :to="calendar.range.value.to"
          :focus-date="calendar.focusDate.value"
          :today="state.overview?.today || ''"
          :events="calendar.events.value"
          :projects="calendar.response.value.projects"
          :selected-id="calendar.selected.value?.id"
          @select="calendar.selectEvent"
          @open-day="calendar.openDate"
        />
        <ActivityProjectLanes
          v-else-if="calendar.view.value === 'lane'"
          :from="calendar.range.value.from"
          :to="calendar.range.value.to"
          :events="calendar.events.value"
          :projects="calendar.response.value.projects"
          :timezone="calendar.response.value.timezone"
          :rollover-hour="calendar.response.value.rollover_hour"
          :selected-id="calendar.selected.value?.id"
          @select="calendar.selectEvent"
        />
        <ActivityTimeGrid
          v-else
          :from="calendar.range.value.from"
          :to="calendar.range.value.to"
          :events="calendar.events.value"
          :projects="calendar.response.value.projects"
          :timezone="calendar.response.value.timezone"
          :rollover-hour="calendar.response.value.rollover_hour"
          :selected-id="calendar.selected.value?.id"
          @select="calendar.selectEvent"
        />
      </div>
      <ActivityInspector
        v-if="calendar.selected.value"
        :event="calendar.selected.value"
        :timezone="calendar.response.value.timezone"
        @close="calendar.selected.value = undefined"
      />
    </div>
  </div>
</template>

<style scoped>
.activity-page {
  display: grid;
  gap: var(--space-xs);
  min-width: 0;
}
.calendar-status {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: var(--space-2xs);
  color: var(--color-ink-2);
  font-size: var(--text-xs);
}
.calendar-status span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.activity-error {
  margin: 0;
  padding: var(--space-xs);
  border: 1px solid var(--color-danger-rule);
  border-radius: var(--radius-surface);
  color: var(--color-danger);
  background: var(--color-danger-soft);
}
.activity-workspace {
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-xs);
}
.activity-workspace.inspecting {
  grid-template-columns: minmax(0, 1fr) 300px;
}
.calendar-surface {
  min-width: 0;
}
.loading-state {
  display: flex;
  min-height: 320px;
  align-items: center;
  justify-content: center;
  gap: var(--space-2xs);
  border: 1px solid var(--color-rule);
  border-radius: var(--radius-surface);
  color: var(--color-ink-2);
  background: var(--color-paper);
}
@media (max-width: 1050px) {
  .activity-workspace {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
