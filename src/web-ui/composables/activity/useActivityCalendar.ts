/**
 * Owns Activity calendar navigation, filtering, selection, and API loading.
 * Responsibility: This composable synchronizes date/view state with the URL and exposes filtered immutable events.
 * Non-responsibility: This composable does not render calendar grids or mutate Activity data.
 *
 * Activityカレンダーの移動、絞り込み、選択、API取得を担当します。
 * 責務: 日付・表示状態をURLと同期し、絞り込んだ不変イベントを公開します。
 * 非責務: カレンダーグリッド描画やActivity変更は行いません。
 *
 * @packageDocumentation
 */

import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { calendarRange, moveFocusDate, type ActivityCalendarViewMode } from "#webUi/composables/activity/calendarMath";
import { getJson } from "#webUi/services/api";
import type { ActivityCalendarEvent, ActivityCalendarResponse } from "#webUi/types/api";

const EMPTY_RESPONSE: ActivityCalendarResponse = {
  from: "",
  to: "",
  timezone: "UTC",
  rollover_hour: 0,
  events: [],
  daily_counts: {},
  projects: [],
};

function validView(value: unknown): ActivityCalendarViewMode {
  return value === "month" || value === "day" || value === "lane" ? value : "week";
}

/** Provides the stateful workflow used by the Activity calendar page. Activityカレンダーページの状態フローを提供します。 */
export function useActivityCalendar(today: () => string) {
  const route = useRoute();
  const router = useRouter();
  const response = ref<ActivityCalendarResponse>(EMPTY_RESPONSE);
  const loading = ref(false);
  const error = ref("");
  const selected = ref<ActivityCalendarEvent>();
  const selectedProjects = ref<string[]>([]);
  const projectsCustomized = ref(false);
  const view = computed(() => validView(route.query.view));
  const focusDate = computed(() => String(route.query.date || today() || new Date().toISOString().slice(0, 10)));
  const range = computed(() => calendarRange(focusDate.value, view.value));
  const events = computed(() =>
    response.value.events.filter((event) => selectedProjects.value.includes(event.project)),
  );

  async function load(): Promise<void> {
    loading.value = true;
    error.value = "";
    try {
      const params = new URLSearchParams(range.value);
      response.value = await getJson<ActivityCalendarResponse>(`/api/activity-calendar?${params.toString()}`);
      selectedProjects.value = projectsCustomized.value
        ? selectedProjects.value.filter((project) => response.value.projects.includes(project))
        : [...response.value.projects];
      if (selected.value && !response.value.events.some((event) => event.id === selected.value?.id))
        selected.value = undefined;
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : String(caught);
    } finally {
      loading.value = false;
    }
  }

  function updateRoute(date: string, mode = view.value): void {
    void router.push({ query: { ...route.query, date, view: mode } });
  }

  function setView(mode: ActivityCalendarViewMode): void {
    updateRoute(focusDate.value, mode);
  }

  function move(direction: -1 | 1): void {
    updateRoute(moveFocusDate(focusDate.value, view.value, direction));
  }

  function goToday(): void {
    updateRoute(today() || new Date().toISOString().slice(0, 10));
  }

  function openDate(date: string): void {
    updateRoute(date, "day");
  }

  function selectEvent(event: ActivityCalendarEvent): void {
    selected.value = event;
  }

  function toggleProject(project: string): void {
    projectsCustomized.value = true;
    selectedProjects.value = selectedProjects.value.includes(project)
      ? selectedProjects.value.filter((value) => value !== project)
      : [...selectedProjects.value, project];
  }

  watch([range, view], () => void load(), { immediate: true });

  return {
    response,
    events,
    loading,
    error,
    selected,
    selectedProjects,
    view,
    focusDate,
    range,
    load,
    setView,
    move,
    goToday,
    openDate,
    selectEvent,
    toggleProject,
  };
}
