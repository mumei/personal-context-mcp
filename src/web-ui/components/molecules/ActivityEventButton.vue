<!-- Hallmark · component: event button · genre: modern-minimal · theme: Personal Context MCP Teal Instrument
     states: default · hover · focus · active · disabled · loading · error · success
     contrast: pass -->
<script setup lang="ts">
import type { ActivityCalendarEvent } from "#webUi/types/api";

withDefaults(
  defineProps<{
    event: ActivityCalendarEvent;
    colorIndex: number;
    timeLabel?: string;
    compact?: boolean;
    selected?: boolean;
  }>(),
  { timeLabel: "", compact: false, selected: false },
);
defineEmits<{ select: [event: ActivityCalendarEvent] }>();
</script>

<template>
  <button
    type="button"
    class="activity-event"
    :class="[`project-${colorIndex}`, { compact, selected }]"
    :title="`${event.title}: ${event.summary}`"
    @click="$emit('select', event)"
  >
    <time v-if="timeLabel">{{ timeLabel }}</time>
    <strong>{{ event.title }}</strong>
    <span v-if="!compact">{{ event.summary }}</span>
  </button>
</template>

<style scoped>
.activity-event {
  --event-color: var(--color-project-1);
  --event-soft: var(--color-project-soft-1);
  display: grid;
  width: 100%;
  min-width: 0;
  min-height: 28px;
  gap: 1px;
  overflow: hidden;
  padding: 4px 6px;
  border: 1px solid color-mix(in oklch, var(--event-color) 48%, var(--color-rule));
  border-left: 3px solid var(--event-color);
  border-radius: var(--radius-control);
  color: var(--color-ink);
  background: var(--event-soft);
  text-align: left;
  transition:
    border-color var(--duration-control) var(--ease-control),
    background-color var(--duration-control) var(--ease-control),
    transform var(--duration-control) var(--ease-control);
}
.activity-event:hover,
.activity-event.is-hover {
  border-color: var(--event-color);
  background: color-mix(in oklch, var(--event-soft) 82%, var(--color-paper));
}
.activity-event:focus-visible,
.activity-event.is-focus {
  outline: 3px solid color-mix(in oklch, var(--color-focus) 55%, transparent);
  outline-offset: 1px;
}
.activity-event:active,
.activity-event.is-active {
  transform: translateY(1px);
}
.activity-event:disabled,
.activity-event.is-loading {
  cursor: default;
  opacity: 0.55;
}
.activity-event.is-error {
  border-color: var(--color-danger);
}
.activity-event.is-success,
.activity-event.selected {
  box-shadow: inset 0 0 0 1px var(--event-color);
}
.activity-event strong,
.activity-event span,
.activity-event time {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.activity-event strong {
  font-size: 11px;
  line-height: 1.3;
}
.activity-event span,
.activity-event time {
  color: var(--color-ink-2);
  font-size: 10px;
}
.activity-event.compact {
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 5px;
}
.project-2 {
  --event-color: var(--color-project-2);
  --event-soft: var(--color-project-soft-2);
}
.project-3 {
  --event-color: var(--color-project-3);
  --event-soft: var(--color-project-soft-3);
}
.project-4 {
  --event-color: var(--color-project-4);
  --event-soft: var(--color-project-soft-4);
}
.project-5 {
  --event-color: var(--color-project-5);
  --event-soft: var(--color-project-soft-5);
}
.project-6 {
  --event-color: var(--color-project-6);
  --event-soft: var(--color-project-soft-6);
}
</style>
