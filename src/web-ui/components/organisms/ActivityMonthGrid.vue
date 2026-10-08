<script setup lang="ts">
import { computed } from "vue";
import ActivityEventButton from "#webUi/components/molecules/ActivityEventButton.vue";
import { datesBetween } from "#webUi/composables/activity/calendarMath";
import { useLocale } from "#webUi/composables/useLocale";
import type { ActivityCalendarEvent } from "#webUi/types/api";

const props = defineProps<{
  from: string;
  to: string;
  focusDate: string;
  today: string;
  events: ActivityCalendarEvent[];
  projects: string[];
  selectedId?: string;
}>();
defineEmits<{ select: [event: ActivityCalendarEvent]; "open-day": [date: string] }>();
const { language, t } = useLocale();
const days = computed(() => datesBetween(props.from, props.to));
const focusMonth = computed(() => props.focusDate.slice(0, 7));
const weekdays = computed(() => {
  const formatter = new Intl.DateTimeFormat(language.value === "en" ? "en-US" : "ja-JP", {
    weekday: "short",
    timeZone: "UTC",
  });
  return datesBetween("2026-07-19", "2026-07-25").map((date) => formatter.format(new Date(`${date}T00:00:00Z`)));
});

function eventsFor(date: string): ActivityCalendarEvent[] {
  return props.events.filter((event) => event.calendar_date === date);
}

function projectColor(project: string): number {
  return (Math.max(0, props.projects.indexOf(project)) % 6) + 1;
}
</script>

<template>
  <section class="month-calendar" :aria-label="t('activityMonthView')">
    <div class="weekday-row">
      <div v-for="weekday in weekdays" :key="weekday">{{ weekday }}</div>
    </div>
    <div class="month-grid">
      <article
        v-for="day in days"
        :key="day"
        class="day-cell"
        :class="{ outside: !day.startsWith(focusMonth), today: day === today }"
      >
        <button
          class="day-number"
          type="button"
          :aria-label="`${day} ${t('activityOpenDay')}`"
          @click="$emit('open-day', day)"
        >
          <time :datetime="day">{{ Number(day.slice(-2)) }}</time>
          <span v-if="eventsFor(day).length">{{ eventsFor(day).length }}</span>
        </button>
        <div class="day-events">
          <ActivityEventButton
            v-for="event in eventsFor(day).slice(0, 3)"
            :key="event.id"
            :event="event"
            :color-index="projectColor(event.project)"
            :selected="selectedId === event.id"
            compact
            @select="$emit('select', $event)"
          />
          <button v-if="eventsFor(day).length > 3" type="button" class="more" @click="$emit('open-day', day)">
            {{ t("activityMore", { count: eventsFor(day).length - 3 }) }}
          </button>
        </div>
        <div class="mobile-dots" aria-hidden="true">
          <i
            v-for="event in eventsFor(day).slice(0, 4)"
            :key="event.id"
            :class="`project-${projectColor(event.project)}`"
          />
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.month-calendar {
  overflow: hidden;
  border: 1px solid var(--color-rule);
  border-radius: var(--radius-surface);
  background: var(--color-paper);
}
.weekday-row,
.month-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
}
.weekday-row {
  border-bottom: 1px solid var(--color-rule-strong);
  background: var(--color-paper-3);
}
.weekday-row div {
  padding: 7px var(--space-2xs);
  color: var(--color-ink-2);
  font-size: var(--text-xs);
  font-weight: 700;
  text-align: center;
}
.day-cell {
  min-width: 0;
  min-height: 118px;
  padding: 5px;
  border-right: 1px solid var(--color-rule);
  border-bottom: 1px solid var(--color-rule);
}
.day-cell:nth-child(7n) {
  border-right: 0;
}
.day-cell.outside {
  background: var(--color-paper-2);
}
.day-cell.today {
  box-shadow: inset 0 0 0 2px var(--color-accent);
}
.day-number {
  display: flex;
  width: 100%;
  min-height: 24px;
  align-items: center;
  justify-content: space-between;
  padding: 0 2px;
  border: 0;
  color: var(--color-ink);
  background: transparent;
}
.outside .day-number {
  color: var(--color-ink-2);
}
.day-number time {
  font-size: var(--text-xs);
  font-weight: 750;
}
.day-number span {
  color: var(--color-ink-2);
  font-size: 10px;
}
.day-events {
  display: grid;
  gap: 3px;
}
.more {
  min-height: 22px;
  padding: 0 4px;
  border: 0;
  color: var(--color-ink-2);
  background: transparent;
  font-size: 10px;
  text-align: left;
}
.mobile-dots {
  display: none;
}
@media (max-width: 760px) {
  .day-cell {
    min-height: 62px;
    padding: 3px;
  }
  .day-events {
    display: none;
  }
  .day-number {
    display: grid;
    justify-content: center;
    text-align: center;
  }
  .day-number span {
    display: none;
  }
  .mobile-dots {
    display: flex;
    justify-content: center;
    gap: 2px;
    margin-top: 4px;
  }
  .mobile-dots i {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--color-project-1);
  }
  .mobile-dots i.project-2 {
    background: var(--color-project-2);
  }
  .mobile-dots i.project-3 {
    background: var(--color-project-3);
  }
  .mobile-dots i.project-4 {
    background: var(--color-project-4);
  }
  .mobile-dots i.project-5 {
    background: var(--color-project-5);
  }
  .mobile-dots i.project-6 {
    background: var(--color-project-6);
  }
}
</style>
