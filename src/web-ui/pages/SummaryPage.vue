<script setup lang="ts">
import { Sparkles } from "@lucide/vue";
import { computed, ref } from "vue";
import { useDashboard } from "#webUi/composables/useDashboard";
import { mutateJson } from "#webUi/services/api";
import BaseButton from "#webUi/components/atoms/BaseButton.vue";
import MorningBrief from "#webUi/components/organisms/MorningBrief.vue";
import { useLocale } from "#webUi/composables/useLocale";
const { state, selectedDate, loadOverview } = useDashboard();
const { t } = useLocale();
const generating = ref(false);
const checking = ref(false);
const today = computed(() => state.overview?.today === selectedDate.value);
const hasTaskPlan = computed(() => {
  const section = state.overview?.morning_brief.sections.find(({ number }) => number === 5);
  return Boolean(section?.table?.rows.length);
});
async function generate() {
  if (!today.value || !window.confirm(t("summaryGenerateConfirm"))) return;
  generating.value = true;
  try {
    await mutateJson("/api/summary/generate", "POST", { date: selectedDate.value, allow_llm_data_sharing: true });
    await loadOverview();
    state.notice = t("summaryGenerated");
  } finally {
    generating.value = false;
  }
}
async function check() {
  if (!today.value || !hasTaskPlan.value || !window.confirm(t("progressCheckConfirm"))) return;
  checking.value = true;
  try {
    await mutateJson("/api/summary/progress", "POST", { date: selectedDate.value, allow_llm_data_sharing: true });
    await loadOverview();
    state.notice = t("progressChecked");
  } finally {
    checking.value = false;
  }
}
</script>
<template>
  <div class="stack">
    <div class="page-heading">
      <div>
        <h2>{{ t("morningBrief") }}</h2>
        <p>{{ selectedDate }}</p>
      </div>
      <div class="actions">
        <BaseButton variant="primary" :disabled="!today || generating" @click="generate"
          ><Sparkles :size="17" />{{ generating ? t("summaryGenerating") : t("summaryGenerate") }}</BaseButton
        >
      </div>
    </div>
    <MorningBrief
      :sections="state.overview?.morning_brief.sections"
      :progress="state.overview?.morning_task_progress"
      :date="selectedDate"
      :checking="checking"
      :can-check-progress="today && hasTaskPlan"
      @check-progress="check"
    />
  </div>
</template>
<style scoped>
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.actions :deep(button) {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}
</style>
