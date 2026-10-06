<script setup lang="ts">
import { computed } from "vue";
import ActivityEventButton from "#webUi/components/molecules/ActivityEventButton.vue";
import { datesBetween } from "#webUi/composables/activity/calendarMath";
import { useLocale } from "#webUi/composables/useLocale";
import type { ActivityCalendarEvent } from "#webUi/types/api";

interface LaneEvent {
  event: ActivityCalendarEvent;
  minute: number;
  index: number;
  timeLabel: string;
}

const props = defineProps<{
  events: ActivityCalendarEvent[];
  projects: string[];
  from: string;
  to: string;
  timezone: string;
  rolloverHour: number;
  selectedId?: string;
}>();
defineEmits<{ select: [event: ActivityCalendarEvent] }>();
const { language, t } = useLocale();
const days = computed(() => datesBetween(props.from, props.to));
const visibleProjects = computed(() =>
  props.projects.filter((project) => props.events.some((event) => event.project === project)),
);

function localTime(value?: string): { minute: number; label: string } | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: props.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(parsed);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  return {
    minute: ((hour - props.rolloverHour + 24) % 24) * 60 + minute,
    label: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  };
}

function dayOffset(value: string): number {
  return Math.max(0, days.value.indexOf(value));
}

function dayLabel(value: string): string {
  return new Intl.DateTimeFormat(language.value === "en" ? "en-US" : "ja-JP", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function laneEvents(project: string): LaneEvent[] {
  const indexes = new Map<number, number>();
  return props.events
    .filter((event) => event.project === project)
    .map((event) => {
      const time = localTime(event.occurred_at);
      const minute = dayOffset(event.operational_date) * 1440 + (time?.minute ?? 0);
      const bucket = Math.floor(minute / 45);
      const index = indexes.get(bucket) ?? 0;
      indexes.set(bucket, index + 1);
      return { event, minute, index, timeLabel: time?.label ?? t("activityUnknownTime") };
    });
}

function laneHeight(project: string): number {
  return Math.max(72, ...laneEvents(project).map((item) => 42 + item.index * 30));
}

function eventStyle(item: LaneEvent): Record<string, string> {
  const totalMinutes = Math.max(1, days.value.length) * 1440;
  return {
    left: `calc(${(item.minute / totalMinutes) * 100}% + 2px)`,
    top: `${8 + item.index * 30}px`,
    width: "150px",
  };
}

function projectColor(project: string): number {
  return (Math.max(0, props.projects.indexOf(project)) % 6) + 1;
}
</script>

<template>
  <section class="lane-calendar" :aria-label="t('activityLaneView')">
    <div class="lane-scroll">
      <div class="lane-content">
        <div class="lane-header">
          <div class="project-heading">{{ t("activityProject") }}</div>
          <div class="day-axis">
            <span v-for="day in days" :key="day">{{ dayLabel(day) }}</span>
          </div>
        </div>
        <div
          v-for="project in visibleProjects"
          :key="project"
          class="lane-row"
          :style="{ height: `${laneHeight(project)}px` }"
        >
          <div class="project-name"><i :class="`project-${projectColor(project)}`" />{{ project }}</div>
          <div class="lane-track">
            <i v-for="day in days" :key="day" class="day-rule" />
            <div v-for="item in laneEvents(project)" :key="item.event.id" class="lane-event" :style="eventStyle(item)">
              <ActivityEventButton
                :event="item.event"
                :color-index="projectColor(project)"
                :time-label="item.timeLabel"
                :selected="selectedId === item.event.id"
                compact
                @select="$emit('select', $event)"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.lane-calendar {
  overflow: hidden;
  border: 1px solid var(--color-rule);
  border-radius: var(--radius-surface);
  background: var(--color-paper);
}
.lane-scroll {
  max-height: 70dvh;
  overflow: auto;
}
.lane-content {
  min-width: 1180px;
}
.lane-header,
.lane-row {
  display: grid;
  grid-template-columns: 180px minmax(1000px, 1fr);
}
.lane-header {
  position: sticky;
  z-index: 5;
  top: 0;
  min-height: 42px;
  border-bottom: 1px solid var(--color-rule-strong);
  background: var(--color-paper-3);
}
.project-heading,
.project-name {
  display: flex;
  position: sticky;
  z-index: 4;
  left: 0;
  align-items: center;
  gap: 7px;
  padding: var(--space-2xs) var(--space-xs);
  border-right: 1px solid var(--color-rule-strong);
  background: var(--color-paper);
  font-size: var(--text-xs);
  font-weight: 700;
}
.project-heading {
  background: var(--color-paper-3);
}
.project-name i {
  width: 8px;
  height: 8px;
  flex: none;
  border-radius: 50%;
  background: var(--color-project-1);
}
.project-name i.project-2 {
  background: var(--color-project-2);
}
.project-name i.project-3 {
  background: var(--color-project-3);
}
.project-name i.project-4 {
  background: var(--color-project-4);
}
.project-name i.project-5 {
  background: var(--color-project-5);
}
.project-name i.project-6 {
  background: var(--color-project-6);
}
.day-axis,
.lane-track {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
}
.day-axis span {
  padding: 10px 0;
  color: var(--color-ink-2);
  border-left: 1px solid var(--color-rule);
  font-family: var(--font-mono);
  font-size: 10px;
  text-align: center;
}
.lane-row {
  min-height: 72px;
  border-bottom: 1px solid var(--color-rule);
}
.lane-track {
  position: relative;
}
.day-rule {
  border-left: 1px solid var(--color-rule);
}
.lane-event {
  position: absolute;
  z-index: 2;
}
</style>
