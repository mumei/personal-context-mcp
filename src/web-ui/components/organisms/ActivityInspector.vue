<script setup lang="ts">
import { Clock3, ExternalLink, X } from "@lucide/vue";
import { computed } from "vue";
import { useLocale } from "#webUi/composables/useLocale";
import type { ActivityCalendarEvent } from "#webUi/types/api";

const props = defineProps<{ event?: ActivityCalendarEvent; timezone: string }>();
defineEmits<{ close: [] }>();
const { language, t } = useLocale();
const time = computed(() => {
  if (!props.event?.occurred_at) return t("activityUnknownTime");
  const parsed = new Date(props.event.occurred_at);
  if (Number.isNaN(parsed.getTime())) return props.event.occurred_at;
  return new Intl.DateTimeFormat(language.value === "en" ? "en-US" : "ja-JP", {
    timeZone: props.timezone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
});
</script>

<template>
  <aside class="activity-inspector" :class="{ empty: !event }">
    <template v-if="event">
      <header>
        <div>
          <p>{{ event.project }}</p>
          <h3>{{ event.title }}</h3>
        </div>
        <button type="button" :aria-label="t('close')" @click="$emit('close')"><X :size="18" /></button>
      </header>
      <p class="time"><Clock3 :size="15" />{{ time }}</p>
      <p class="summary">{{ event.summary }}</p>
      <section v-if="event.done.length">
        <h4>{{ t("activityDone") }}</h4>
        <ul>
          <li v-for="item in event.done" :key="item">{{ item }}</li>
        </ul>
      </section>
      <section v-if="event.next.length">
        <h4>{{ t("activityNext") }}</h4>
        <ul>
          <li v-for="item in event.next" :key="item">{{ item }}</li>
        </ul>
      </section>
      <RouterLink
        :to="{
          name: 'task',
          params: { taskId: event.task_id, view: 'current' },
          query: { date: event.operational_date },
        }"
      >
        {{ t("activityOpenTask") }}<ExternalLink :size="14" />
      </RouterLink>
    </template>
    <div v-else class="empty-copy">
      <Clock3 :size="22" />
      <p>{{ t("activitySelectEvent") }}</p>
    </div>
  </aside>
</template>

<style scoped>
.activity-inspector {
  min-width: 0;
  padding: var(--space-sm);
  overflow-y: auto;
  border: 1px solid var(--color-rule);
  border-radius: var(--radius-surface);
  background: var(--color-paper);
}
header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-xs);
  padding-bottom: var(--space-xs);
  border-bottom: 1px solid var(--color-rule);
}
header p,
header h3 {
  margin: 0;
}
header p {
  color: var(--color-ink-2);
  font-size: var(--text-xs);
}
header h3 {
  margin-top: 4px;
  overflow-wrap: anywhere;
  font-size: var(--text-md);
}
header button {
  display: grid;
  width: var(--control-height);
  height: var(--control-height);
  flex: none;
  place-items: center;
  border: 1px solid var(--color-rule);
  border-radius: var(--radius-control);
  color: var(--color-ink);
  background: var(--color-paper);
}
.time {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-ink-2);
  font-size: var(--text-xs);
}
.summary {
  line-height: 1.6;
}
section {
  margin-top: var(--space-sm);
  padding-top: var(--space-xs);
  border-top: 1px solid var(--color-rule);
}
section h4 {
  margin: 0 0 var(--space-2xs);
  font-size: var(--text-sm);
}
ul {
  margin: 0;
  padding-left: 18px;
  color: var(--color-ink-2);
  font-size: var(--text-sm);
  line-height: 1.6;
}
a {
  display: inline-flex;
  min-height: var(--control-height);
  align-items: center;
  gap: 6px;
  margin-top: var(--space-sm);
  color: var(--color-accent-hover);
  font-weight: 700;
  text-decoration: none;
}
.empty-copy {
  display: grid;
  min-height: 180px;
  place-content: center;
  justify-items: center;
  color: var(--color-ink-2);
  text-align: center;
}
@media (max-width: 1050px) {
  .activity-inspector.empty {
    display: none;
  }
}
</style>
