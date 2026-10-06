<script setup lang="ts">
import { Sparkles } from "@lucide/vue";
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useDashboard } from "#webUi/composables/useDashboard";
import { mutateJson } from "#webUi/services/api";
import BaseButton from "#webUi/components/atoms/BaseButton.vue";
import DataList from "#webUi/components/molecules/DataList.vue";
import TaskTabs from "#webUi/components/molecules/TaskTabs.vue";
import TaskCurrentStatus from "#webUi/components/organisms/TaskCurrentStatus.vue";
import { useLocale } from "#webUi/composables/useLocale";
const route = useRoute();
const router = useRouter();
const { state, loadTask, selectedDate } = useDashboard();
const working = ref("");
const taskId = computed(() => String(route.params.taskId));
const view = computed(() => String(route.params.view || "current"));
const { t } = useLocale();
async function load() {
  await loadTask(taskId.value);
}
function select(next: string) {
  void router.push({ name: "task", params: { taskId: taskId.value, view: next }, query: route.query });
}
async function run(kind: "organize" | "mindmap") {
  if (!window.confirm(t(kind === "organize" ? "organizeConfirm" : "mindMapConfirm"))) return;
  working.value = kind;
  try {
    await mutateJson(`/api/task/${encodeURIComponent(taskId.value)}/${kind}`, "POST", {
      date: selectedDate.value,
      allow_llm_data_sharing: true,
    });
    await load();
    state.notice = t(kind === "organize" ? "organizedTask" : "mindMapUpdated");
  } finally {
    working.value = "";
  }
}
onMounted(load);
watch(() => [taskId.value, selectedDate.value], load);
</script>
<template>
  <div v-if="state.detail" class="task-page">
    <TaskTabs :active="view" @select="select" />
    <main>
      <TaskCurrentStatus v-if="view === 'current'" :detail="state.detail"
        ><template #mindmap-action
          ><BaseButton :disabled="!!working" @click="run('mindmap')"
            ><Sparkles :size="16" />{{ working === "mindmap" ? t("generating") : t("mindMapGenerate") }}</BaseButton
          ></template
        ></TaskCurrentStatus
      >
      <section v-else-if="view === 'overview'" class="surface block">
        <div class="heading">
          <h3>{{ t("overview") }}</h3>
          <BaseButton variant="primary" :disabled="!!working" @click="run('organize')"
            ><Sparkles :size="16" />{{ working === "organize" ? t("organizingTask") : t("organizeTask") }}</BaseButton
          >
        </div>
        <article class="markdown-body" v-html="state.detail.context_body_html" />
      </section>
      <section v-else-if="view === 'context'" class="surface block">
        <h3>{{ t("context") }}</h3>
        <DataList :value="state.detail.context.data" />
      </section>
      <section v-else class="surface block">
        <h3>{{ t("taskMemory") }}</h3>
        <DataList :value="state.detail.memory" />
      </section>
    </main>
  </div>
</template>
<style scoped>
.task-page {
  margin: calc(var(--space-md) * -1);
}
.task-page main {
  padding: var(--space-md);
}
.block {
  padding: 20px;
}
.heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.heading h3 {
  margin: 0;
}
.heading :deep(button),
:deep(.button) {
  display: flex;
  align-items: center;
  gap: 6px;
}
@media (max-width: 760px) {
  .task-page {
    margin: calc(var(--space-xs) * -1);
  }
  .task-page main {
    padding: var(--space-xs) var(--space-xs) var(--space-lg);
  }
}
</style>
