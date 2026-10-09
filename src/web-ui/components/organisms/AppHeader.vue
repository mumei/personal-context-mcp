<script setup lang="ts">
import { Menu, RefreshCw } from "@lucide/vue";
import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import { useDashboard } from "#webUi/composables/useDashboard";
import IconButton from "#webUi/components/atoms/IconButton.vue";
import TaskMeta from "#webUi/components/molecules/TaskMeta.vue";
import ToggleSwitch from "#webUi/components/atoms/ToggleSwitch.vue";
import { useLocale } from "#webUi/composables/useLocale";

const { state, selectedDate, setDate, loadOverview, updateTaskReportVisibility, openSidebar } = useDashboard();
const route = useRoute();
const { t } = useLocale();
const visibilitySaving = ref(false);
const hidesDateTools = computed(() =>
  ["tickets", "activity", "global", "knowledge", "people", "settings", "help", "weekly-report"].includes(
    String(route.name),
  ),
);
const title = computed(() =>
  route.name === "tickets"
    ? t("tickets")
    : route.name === "summary"
      ? t("summary")
      : route.name === "report" || route.name === "weekly-report"
        ? t("report")
        : route.name === "activity"
          ? t("activity")
          : route.name === "global"
            ? t("global")
            : route.name === "knowledge"
              ? t("knowledge")
              : route.name === "people"
                ? t("people")
                : route.name === "settings"
                  ? t("settings")
                  : route.name === "help"
                    ? t("help")
                    : state.detail?.task.title || "Task",
);

async function setReportVisibility(visible: boolean): Promise<void> {
  const task = state.detail?.task;
  if (!task || visibilitySaving.value) return;
  visibilitySaving.value = true;
  state.error = "";
  try {
    await updateTaskReportVisibility(task.id, visible);
    state.notice = t(visible ? "reportIncludedNotice" : "reportExcludedNotice");
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
  } finally {
    visibilitySaving.value = false;
  }
}
</script>
<template>
  <header>
    <IconButton
      id="app-menu-trigger"
      class="menu"
      :label="t('menu')"
      aria-controls="app-mobile-sidebar"
      :aria-expanded="state.sidebarOpen"
      @click="openSidebar($event.currentTarget as HTMLButtonElement)"
      ><Menu :size="20"
    /></IconButton>
    <div class="title">
      <h2>{{ title }}</h2>
      <div v-if="state.detail?.task && route.name === 'task'" class="task-details">
        <TaskMeta :task="state.detail.task" show-id />
        <ToggleSwitch
          :model-value="state.detail.task.report_exclude !== true"
          :label="t('reportVisible')"
          :disabled="visibilitySaving"
          @update:model-value="setReportVisibility"
        />
      </div>
      <p v-else>
        {{
          route.name === "summary"
            ? t("morningBrief")
            : route.name === "weekly-report"
              ? t("weeklyReport")
              : route.name === "report"
                ? t("dailyReport")
                : route.name === "activity"
                  ? t("activityDescription")
                  : route.name === "global"
                    ? t("globalDescription")
                    : route.name === "knowledge"
                      ? t("knowledgeDescription")
                      : route.name === "people"
                        ? t("peopleDescription")
                        : route.name === "settings"
                          ? t("settings")
                          : route.name === "help"
                            ? t("helpDescription")
                            : ""
        }}
      </p>
    </div>
    <div v-if="!hidesDateTools" class="tools">
      <input
        type="date"
        :value="selectedDate"
        :aria-label="t('auditDate')"
        @change="setDate(($event.target as HTMLInputElement).value)"
      /><IconButton :label="t('reload')" @click="loadOverview"><RefreshCw :size="18" /></IconButton>
    </div>
  </header>
</template>
<style scoped>
header {
  display: flex;
  position: sticky;
  z-index: 20;
  top: 0;
  min-height: var(--header-height);
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-2xs) var(--space-md);
  border-bottom: 1px solid var(--line);
  background: color-mix(in oklch, var(--surface) 96%, transparent);
  backdrop-filter: blur(12px);
}
.menu {
  display: none;
}
.title {
  min-width: 0;
  flex: 1;
}
.title h2 {
  margin: 0;
  font-size: var(--text-lg);
  line-height: 1.25;
}
.title p {
  margin: 5px 0 0;
  color: var(--muted);
  font-size: var(--text-xs);
}
.task-details {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 14px;
  margin-top: 5px;
}
.tools {
  display: flex;
  align-items: center;
  gap: 8px;
}
.tools input {
  min-height: var(--control-height);
  padding: var(--space-2xs) var(--space-xs);
  border: 1px solid var(--line);
  border-radius: var(--radius-control);
  color: var(--color-ink);
  background: var(--color-paper);
}
@media (max-width: 900px) {
  header {
    display: grid;
    grid-template-columns: var(--control-height) minmax(0, 1fr);
    padding: var(--space-2xs) var(--space-xs);
  }
  .menu {
    display: inline-grid;
    grid-column: 1;
  }
  .title {
    grid-column: 2;
  }
  .tools {
    display: grid;
    grid-column: 1 / -1;
    grid-template-columns: minmax(0, 1fr) var(--control-height);
    width: 100%;
  }
  .tools input {
    width: 100%;
    max-width: none;
  }
}
</style>
