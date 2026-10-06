/**
 * Provides use dashboard capabilities for the web UI layer.
 * Responsibility: This module owns the use dashboard behavior and contracts declared here.
 * Non-responsibility: This module does not own unrelated workflows or concerns assigned to other layers.
 *
 * Web UI層のuse dashboard機能を提供します。
 * 責務: このモジュールは、ここで宣言するuse dashboardの振る舞いと契約を担当します。
 * 非責務: このモジュールは、無関係なワークフローや他の層に割り当てられた関心事を担当しません。
 *
 * @packageDocumentation
 */

import { computed, nextTick, reactive } from "vue";
import { useRoute, useRouter } from "vue-router";
import { getJson, mutateJson } from "#webUi/services/api";
import type { Overview, Task, TaskDetail } from "#webUi/types/api";

const state = reactive<{
  overview: Overview | null;
  detail: TaskDetail | null;
  loading: boolean;
  error: string;
  notice: string;
  sidebarOpen: boolean;
  sidebarTrigger: HTMLElement | null;
  taskQuery: string;
  status: string;
  sort: string;
}>({
  overview: null,
  detail: null,
  loading: false,
  error: "",
  notice: "",
  sidebarOpen: false,
  sidebarTrigger: null,
  taskQuery: "",
  status: "all",
  sort: localStorage.getItem("task-mcp-task-sort") || "updatedDesc",
});

/**
 * Performs the public `useDashboard` operation provided by this module.
 *
 * このモジュールが提供する公開操作`useDashboard`を実行します。
 */
export function useDashboard() {
  const route = useRoute();
  const router = useRouter();
  const selectedDate = computed(() => String(route.query.date || state.overview?.today || ""));
  const tasks = computed(() => {
    const source = [...(state.overview?.tasks || [])];
    const query = state.taskQuery.trim().toLowerCase();
    const filtered = source.filter(
      (task) =>
        (state.status === "all" || task.status === state.status) &&
        (!query || [task.title, task.id, task.project].filter(Boolean).join(" ").toLowerCase().includes(query)),
    );
    const byName = (a: Task, b: Task) => a.title.localeCompare(b.title, "ja", { numeric: true });
    if (state.sort === "nameAsc") return filtered.sort(byName);
    if (state.sort === "nameDesc") return filtered.sort((a, b) => byName(b, a));
    if (state.sort === "updatedAsc" || state.sort === "updatedDesc") {
      const direction = state.sort === "updatedDesc" ? -1 : 1;
      return filtered.sort(
        (a, b) =>
          direction *
            String(state.overview?.task_last_updated[a.id] || "").localeCompare(
              String(state.overview?.task_last_updated[b.id] || ""),
            ) || byName(a, b),
      );
    }
    return filtered;
  });

  async function loadOverview(): Promise<void> {
    state.loading = true;
    state.error = "";
    try {
      const suffix = selectedDate.value ? `?date=${encodeURIComponent(selectedDate.value)}` : "";
      state.overview = await getJson<Overview>(`/api/overview${suffix}`);
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
    } finally {
      state.loading = false;
    }
  }

  async function loadTask(taskId: string): Promise<void> {
    state.loading = true;
    state.error = "";
    try {
      state.detail = await getJson<TaskDetail>(
        `/api/task/${encodeURIComponent(taskId)}?date=${encodeURIComponent(selectedDate.value)}`,
      );
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
    } finally {
      state.loading = false;
    }
  }

  async function updateTaskReportVisibility(taskId: string, visible: boolean): Promise<Task> {
    const result = await mutateJson<{ task: Task; visible: boolean }>(
      `/api/task/${encodeURIComponent(taskId)}/report-visibility`,
      "PUT",
      { visible, date: selectedDate.value },
    );
    if (state.detail?.task.id === taskId) {
      state.detail.task = result.task;
    }
    const overviewTask = state.overview?.tasks.find((task) => task.id === taskId);
    if (overviewTask) {
      Object.assign(overviewTask, result.task);
    }
    return result.task;
  }

  function setDate(date: string): void {
    void router.push({ query: { ...route.query, date } });
  }

  function setSort(sort: string): void {
    state.sort = sort;
    localStorage.setItem("task-mcp-task-sort", sort);
  }

  function openSidebar(trigger?: HTMLElement): void {
    state.sidebarTrigger = trigger || null;
    state.sidebarOpen = true;
  }

  function closeSidebar(restoreFocus = true): void {
    const trigger = state.sidebarTrigger;
    state.sidebarOpen = false;
    state.sidebarTrigger = null;
    if (restoreFocus && trigger) {
      void nextTick(() => trigger.focus());
    }
  }

  return {
    state,
    route,
    router,
    selectedDate,
    tasks,
    loadOverview,
    loadTask,
    updateTaskReportVisibility,
    setDate,
    setSort,
    openSidebar,
    closeSidebar,
  };
}
