<script setup lang="ts">
import { computed } from "vue";
import ActivityEventButton from "#webUi/components/molecules/ActivityEventButton.vue";
import { datesBetween } from "#webUi/composables/activity/calendarMath";
import { useLocale } from "#webUi/composables/useLocale";
import type { ActivityCalendarEvent } from "#webUi/types/api";

interface PositionedEvent {
  event: ActivityCalendarEvent;
  minute: number;
  overlapIndex: number;
  overlapCount: number;
  timeLabel: string;
}

const props = defineProps<{
  from: string;
  to: string;
  events: ActivityCalendarEvent[];
  projects: string[];
  timezone: string;
  selectedId?: string;
}>();
defineEmits<{ select: [event: ActivityCalendarEvent] }>();
const { language, t } = useLocale();
const days = computed(() => datesBetween(props.from, props.to));
const hours = Array.from({ length: 24 }, (_, index) => index);

function localHourMinute(value: string): { hour: number; minute: number; label: string } | undefined {
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
  return { hour, minute, label: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` };
}

function positionedFor(date: string): PositionedEvent[] {
  const positioned = props.events
    .filter((event) => event.calendar_date === date && event.occurred_at)
    .flatMap((event) => {
      const time = localHourMinute(event.occurred_at ?? "");
      if (!time) return [];
      const minute = time.hour * 60 + time.minute;
      return [{ event, minute, bucket: Math.floor(minute / 30), timeLabel: time.label }];
    });
  const bucketCounts = new Map<number, number>();
  for (const item of positioned) bucketCounts.set(item.bucket, (bucketCounts.get(item.bucket) ?? 0) + 1);
  const bucketIndexes = new Map<number, number>();
  return positioned.map((item) => {
    const overlapIndex = bucketIndexes.get(item.bucket) ?? 0;
    bucketIndexes.set(item.bucket, overlapIndex + 1);
    return { ...item, overlapIndex, overlapCount: bucketCounts.get(item.bucket) ?? 1 };
  });
}

function unknownFor(date: string): ActivityCalendarEvent[] {
  return props.events.filter((event) => event.calendar_date === date && !event.occurred_at);
}

function eventStyle(item: PositionedEvent): Record<string, string> {
  return {
    top: `${(item.minute / 30) * 24}px`,
    left: `calc(${(item.overlapIndex / item.overlapCount) * 100}% + 2px)`,
    width: `calc(${100 / item.overlapCount}% - 4px)`,
  };
}

function projectColor(project: string): number {
  return (Math.max(0, props.projects.indexOf(project)) % 6) + 1;
}

function dayLabel(date: string): string {
  return new Intl.DateTimeFormat(language.value === "en" ? "en-US" : "ja-JP", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}
</script>

<template>
  <section class="time-calendar" :aria-label="t('activityTimeView')">
    <div class="time-scroll">
      <div class="time-header" :style="{ '--day-count': String(days.length) }">
        <div class="time-corner">{{ t("activityTime") }}</div>
        <div v-for="day in days" :key="day" class="day-heading">{{ dayLabel(day) }}</div>
        <div class="unknown-label">{{ t("activityUnknownTime") }}</div>
        <div v-for="day in days" :key="`unknown-${day}`" class="unknown-events">
          <ActivityEventButton
            v-for="event in unknownFor(day)"
            :key="event.id"
            :event="event"
            :color-index="projectColor(event.project)"
            :selected="selectedId === event.id"
            compact
            @select="$emit('select', $event)"
          />
        </div>
      </div>
      <div class="time-body" :style="{ '--day-count': String(days.length) }">
        <div class="hour-labels">
          <span v-for="hour in hours" :key="hour">{{ String(hour).padStart(2, "0") }}:00</span>
        </div>
        <div v-for="day in days" :key="day" class="day-column">
          <div v-for="hour in hours" :key="hour" class="hour-line" />
          <div
            v-for="item in positionedFor(day)"
            :key="item.event.id"
            class="positioned-event"
            :style="eventStyle(item)"
          >
            <ActivityEventButton
              :event="item.event"
              :color-index="projectColor(item.event.project)"
              :time-label="item.timeLabel"
              :selected="selectedId === item.event.id"
              @select="$emit('select', $event)"
            />
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.time-calendar {
  overflow: hidden;
  border: 1px solid var(--color-rule);
  border-radius: var(--radius-surface);
  background: var(--color-paper);
}
.time-header,
.time-body {
  display: grid;
  grid-template-columns: 62px repeat(var(--day-count), minmax(130px, 1fr));
  min-width: calc(62px + (var(--day-count) * 130px));
}
.time-header {
  position: sticky;
  z-index: 4;
  top: 0;
  border-bottom: 1px solid var(--color-rule-strong);
  background: var(--color-paper);
}
.time-corner,
.day-heading,
.unknown-label {
  padding: 8px;
  color: var(--color-ink-2);
  background: var(--color-paper-3);
  font-size: var(--text-xs);
  font-weight: 700;
}
.time-corner,
.unknown-label {
  position: sticky;
  z-index: 6;
  left: 0;
  border-right: 1px solid var(--color-rule-strong);
}
.day-heading,
.unknown-events {
  border-left: 1px solid var(--color-rule);
}
.day-heading {
  text-align: center;
}
.unknown-label {
  border-top: 1px solid var(--color-rule);
}
.unknown-events {
  display: grid;
  min-height: 38px;
  gap: 3px;
  padding: 4px;
  border-top: 1px solid var(--color-rule);
}
.time-scroll {
  height: min(66dvh, 720px);
  overflow: auto;
}
.time-body {
  height: 1152px;
}
.hour-labels {
  display: grid;
  position: sticky;
  z-index: 3;
  left: 0;
  grid-template-rows: repeat(24, 48px);
  border-right: 1px solid var(--color-rule-strong);
  background: var(--color-paper);
}
.hour-labels span {
  padding: 4px 8px 0 0;
  color: var(--color-ink-2);
  background: var(--color-paper);
  font-family: var(--font-mono);
  font-size: 10px;
  text-align: right;
}
.day-column {
  position: relative;
  border-left: 1px solid var(--color-rule);
}
.hour-line {
  height: 48px;
  border-top: 1px solid var(--color-rule);
}
.positioned-event {
  position: absolute;
  z-index: 2;
  min-width: 0;
}
@media (max-width: 760px) {
  .time-scroll {
    height: 62dvh;
  }
}
</style>
