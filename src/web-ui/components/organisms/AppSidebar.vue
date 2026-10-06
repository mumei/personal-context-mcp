<script setup lang="ts">
import {
  CalendarClock,
  CircleHelp,
  FileText,
  Globe2,
  LayoutDashboard,
  Network,
  Settings,
  UsersRound,
  X,
} from "@lucide/vue";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useDashboard } from "#webUi/composables/useDashboard";
import IconButton from "#webUi/components/atoms/IconButton.vue";
import TaskMeta from "#webUi/components/molecules/TaskMeta.vue";
import { useLocale } from "#webUi/composables/useLocale";
import { retainedTaskView } from "#webUi/navigation/taskView";

const { state, tasks, setSort, closeSidebar } = useDashboard();
const route = useRoute();
const { t } = useLocale();
const sidebar = ref<HTMLElement>();
const compactViewport = ref(false);
let compactMediaQuery: MediaQueryList | undefined;
const taskView = computed(() => retainedTaskView(route.name, route.params.view));
const statuses = ["all", "todo", "inProgress", "waiting", "blocked", "done"] as const;
const total = computed(() =>
  Object.values(state.overview?.counts || {}).reduce((sum, count) => sum + Number(count), 0),
);
function count(status: string): number {
  return status === "all"
    ? total.value
    : Number(state.overview?.counts?.[status as keyof typeof state.overview.counts] || 0);
}

function updateCompactViewport(event?: MediaQueryListEvent): void {
  compactViewport.value = event?.matches ?? compactMediaQuery?.matches ?? false;
}

function focusableElements(): HTMLElement[] {
  return Array.from(
    sidebar.value?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) || [],
  ).filter((element) => !element.hasAttribute("inert") && element.getAttribute("aria-hidden") !== "true");
}

function trapFocus(event: KeyboardEvent): void {
  if (!compactViewport.value || !state.sidebarOpen) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeSidebar();
    return;
  }
  if (event.key !== "Tab") return;
  const elements = focusableElements();
  if (!elements.length) return;
  const first = elements[0];
  const last = elements[elements.length - 1];
  if (event.shiftKey && globalThis.document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && globalThis.document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

watch(
  () => state.sidebarOpen,
  (open) => {
    if (open && compactViewport.value) {
      void nextTick(() => sidebar.value?.querySelector<HTMLElement>(".mobile-close")?.focus());
    }
  },
);
watch(compactViewport, (compact) => {
  if (!compact && state.sidebarOpen) closeSidebar(false);
});
watch(
  () => route.fullPath,
  () => {
    if (compactViewport.value && state.sidebarOpen) closeSidebar(false);
  },
);
onMounted(() => {
  compactMediaQuery = window.matchMedia("(max-width: 900px)");
  updateCompactViewport();
  compactMediaQuery.addEventListener("change", updateCompactViewport);
  globalThis.document.addEventListener("keydown", trapFocus);
});
onBeforeUnmount(() => {
  compactMediaQuery?.removeEventListener("change", updateCompactViewport);
  globalThis.document.removeEventListener("keydown", trapFocus);
});
</script>

<template>
  <aside
    id="app-mobile-sidebar"
    ref="sidebar"
    class="sidebar"
    :class="{ open: state.sidebarOpen }"
    :role="compactViewport ? 'dialog' : undefined"
    :aria-label="compactViewport ? t('menu') : undefined"
    :aria-modal="compactViewport && state.sidebarOpen ? 'true' : undefined"
    :aria-hidden="compactViewport && !state.sidebarOpen ? 'true' : undefined"
    :inert="compactViewport && !state.sidebarOpen ? true : undefined"
  >
    <div class="brand">
      <div class="brand-copy">
        <h1>Personal Context MCP</h1>
        <p>{{ state.overview?.root }}</p>
      </div>
      <div class="brand-actions">
        <RouterLink to="/help" class="brand-link help-link"
          ><CircleHelp :size="19" /><span class="sr-only">{{ t("help") }}</span></RouterLink
        ><RouterLink to="/settings" class="brand-link settings"
          ><Settings :size="18" /><span class="sr-only">{{ t("settings") }}</span></RouterLink
        >
      </div>
      <IconButton class="mobile-close" :label="t('close')" @click="closeSidebar()"><X :size="18" /></IconButton>
    </div>
    <nav class="primary-nav" :aria-label="t('primaryNavigation')">
      <RouterLink to="/tickets"
        ><LayoutDashboard :size="17" /><span
          ><strong>{{ t("tickets") }}</strong></span
        ></RouterLink
      >
      <RouterLink to="/summary" :title="`${t('summary')}: ${t('morningBrief')}`"
        ><LayoutDashboard :size="17" /><span
          ><strong>{{ t("summary") }}</strong
          ><small>{{ t("morningBrief") }}</small></span
        ></RouterLink
      >
      <RouterLink to="/report/text" :title="`${t('report')}: ${t('dailyReport')}`"
        ><FileText :size="17" /><span
          ><strong>{{ t("report") }}</strong
          ><small>{{ t("dailyReport") }}</small></span
        ></RouterLink
      >
      <RouterLink to="/activity" :title="`${t('activity')}: ${t('activityNavDescription')}`"
        ><CalendarClock :size="17" /><span
          ><strong>{{ t("activity") }}</strong
          ><small>{{ t("activityNavDescription") }}</small></span
        ></RouterLink
      >
      <RouterLink to="/global" :title="`${t('global')}: ${t('globalDescription')}`"
        ><Globe2 :size="17" /><span
          ><strong>{{ t("global") }}</strong
          ><small>{{ t("globalDescription") }}</small></span
        ></RouterLink
      >
      <RouterLink to="/knowledge" :title="`${t('knowledge')}: ${t('knowledgeNavDescription')}`"
        ><Network :size="17" /><span
          ><strong>{{ t("knowledge") }}</strong
          ><small>{{ t("knowledgeNavDescription") }}</small></span
        ></RouterLink
      >
      <RouterLink to="/people" :title="`${t('people')}: ${t('peopleNavDescription')}`"
        ><UsersRound :size="17" /><span
          ><strong>{{ t("people") }}</strong
          ><small>{{ t("peopleNavDescription") }}</small></span
        ></RouterLink
      >
    </nav>
    <div class="tools">
      <label class="sr-only" for="task-filter">{{ t("filterTasks") }}</label>
      <input id="task-filter" v-model="state.taskQuery" type="search" :placeholder="t('filterTasks')" />
      <select
        :value="state.sort"
        :aria-label="t('taskOrder')"
        @change="setSort(($event.target as HTMLSelectElement).value)"
      >
        <option value="updatedDesc">{{ t("recentlyUpdated") }}</option>
        <option value="updatedAsc">{{ t("oldestUpdated") }}</option>
        <option value="nameAsc">{{ t("nameAsc") }}</option>
        <option value="nameDesc">{{ t("nameDesc") }}</option>
      </select>
      <div class="filters" role="group" :aria-label="t('filterTasks')">
        <button
          v-for="item in statuses"
          :key="item"
          type="button"
          :class="{ active: state.status === item }"
          :aria-pressed="state.status === item"
          @click="state.status = item"
        >
          <span>{{ t(item) }}</span
          ><b>{{ count(item) }}</b>
        </button>
      </div>
    </div>
    <nav class="tasks" :aria-label="t('taskList')">
      <RouterLink
        v-for="task in tasks"
        :key="task.id"
        :to="{ name: 'task', params: { taskId: task.id, view: taskView }, query: route.query }"
        :title="task.title"
        @click="closeSidebar(false)"
      >
        <strong>{{ task.title }}</strong
        ><TaskMeta :task="task" /><code>{{ task.id }}</code>
      </RouterLink>
    </nav>
  </aside>
  <button v-if="state.sidebarOpen" class="backdrop" :aria-label="t('closeMenu')" @click="closeSidebar()" />
</template>

<style scoped>
.sidebar {
  display: grid;
  position: sticky;
  top: 0;
  min-height: 0;
  height: 100dvh;
  overflow: hidden;
  grid-template-rows: auto auto auto minmax(0, 1fr);
  color: var(--color-sidebar-text);
  background: var(--sidebar);
  border-right: 1px solid var(--color-sidebar-rule);
}
.brand {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px;
  border-bottom: 1px solid var(--sidebar-line);
}
.brand-copy {
  min-width: 0;
  flex: 1;
}
h1 {
  margin: 0;
  color: var(--color-sidebar-text);
  font-size: var(--text-lg);
}
.brand p {
  margin: 4px 0 0;
  overflow: hidden;
  color: var(--color-sidebar-muted);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  text-overflow: ellipsis;
}
.brand-actions {
  display: flex;
  flex: none;
  gap: 7px;
  margin-left: auto;
}
.brand-link {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border: 1px solid var(--color-sidebar-rule);
  border-radius: 5px;
  color: var(--color-sidebar-text);
  text-decoration: none;
}
.settings {
  background: var(--color-accent-hover);
}
.help-link {
  background: var(--color-sidebar-raised);
}
.brand-link.router-link-active {
  border-color: var(--color-focus);
  background: var(--color-accent);
}
.mobile-close {
  display: none;
}
.primary-nav {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 5px;
  padding: 8px 12px;
}
.primary-nav a {
  display: grid;
  min-width: 0;
  min-height: 38px;
  grid-template-columns: 18px minmax(0, 1fr);
  align-items: center;
  gap: 6px;
  padding: 7px 8px;
  border: 1px solid var(--sidebar-line);
  border-radius: var(--radius-control);
  color: inherit;
  text-decoration: none;
}
.primary-nav a > span {
  min-width: 0;
}
.primary-nav a strong {
  display: block;
  overflow: hidden;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.primary-nav a small {
  display: none;
}
.primary-nav a.router-link-active {
  border-color: var(--color-accent);
  background: var(--color-sidebar-raised);
}
.tools {
  display: grid;
  gap: 6px;
  padding: 0 12px 8px;
  border-bottom: 1px solid var(--sidebar-line);
}
input,
select {
  width: 100%;
  min-height: 34px;
  padding: 6px 9px;
  border: 1px solid var(--color-sidebar-rule);
  border-radius: var(--radius-control);
  color: var(--color-ink);
  background: var(--color-sidebar-input);
}
.filters {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
}
.filters button {
  display: flex;
  justify-content: space-between;
  gap: 4px;
  min-width: 0;
  padding: 5px;
  border: 1px solid var(--sidebar-line);
  border-radius: 4px;
  color: var(--color-sidebar-text);
  background: transparent;
  font-size: 11px;
}
.filters button.active {
  border-color: var(--color-focus);
  background: var(--color-accent);
}
.filters b {
  padding: 1px 5px;
  border-radius: 3px;
  background: color-mix(in oklch, var(--color-sidebar-text) 15%, transparent);
}
.tasks {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}
.tasks a {
  display: grid;
  gap: 6px;
  padding: 9px 16px;
  color: inherit;
  text-decoration: none;
  border-left: 3px solid transparent;
}
.tasks a:hover,
.tasks a.router-link-active {
  border-color: var(--color-focus);
  background: var(--color-sidebar-raised);
}
.tasks strong {
  overflow: hidden;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tasks code {
  overflow: hidden;
  color: var(--color-sidebar-muted);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.backdrop {
  display: none;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
}
@media (max-height: 720px) {
  .brand {
    padding-block: 9px;
  }
  .brand p {
    display: none;
  }
  .primary-nav {
    padding-block: 6px;
  }
  .primary-nav a {
    min-height: 34px;
    padding-block: 5px;
  }
}
@media (max-width: 900px) {
  .sidebar {
    position: fixed;
    z-index: 30;
    width: min(88vw, 330px);
    transform: translateX(-102%);
    transition: transform var(--duration-control) var(--ease-control);
  }
  .sidebar.open {
    transform: translateX(0);
  }
  .mobile-close {
    display: inline-grid;
  }
  .backdrop {
    display: block;
    position: fixed;
    z-index: 29;
    inset: 0;
    border: 0;
    background: var(--color-sidebar-overlay);
  }
}
</style>
