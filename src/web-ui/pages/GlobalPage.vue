<script setup lang="ts">
import { Sparkles } from "@lucide/vue";
import { computed, ref } from "vue";
import { useDashboard } from "#webUi/composables/useDashboard";
import { mutateJson } from "#webUi/services/api";
import BaseButton from "#webUi/components/atoms/BaseButton.vue";
import DataList from "#webUi/components/molecules/DataList.vue";
import SectionHeader from "#webUi/components/molecules/SectionHeader.vue";
import { useLocale } from "#webUi/composables/useLocale";
const { state, loadOverview } = useDashboard();
const resolving = ref(false);
const pending = computed(() => state.overview?.unresolved_agent_updates || []);
const { t } = useLocale();
async function resolve() {
  if (!window.confirm(t("resolveConfirm"))) return;
  resolving.value = true;
  try {
    await mutateJson("/api/global/resolve-agent-updates", "POST", { allow_llm_data_sharing: true });
    await loadOverview();
    state.notice = t("resolved");
  } finally {
    resolving.value = false;
  }
}
</script>
<template>
  <div class="stack">
    <div class="page-heading">
      <div>
        <h2>{{ t("global") }}</h2>
        <p>{{ t("globalState") }}</p>
      </div>
    </div>
    <section class="surface block">
      <SectionHeader :title="t('globalMemory')" /><DataList :value="state.overview?.global_memory" />
    </section>
    <section class="surface block">
      <SectionHeader :title="t('operationalWarnings')"
        ><BaseButton v-if="pending.length" variant="primary" :disabled="resolving" @click="resolve"
          ><Sparkles :size="16" />{{ resolving ? t("resolvingWithAi") : t("resolveWithAi") }}</BaseButton
        ></SectionHeader
      >
      <p v-if="pending.length" class="warning">{{ t("pendingUpdates") }} ({{ pending.length }})</p>
      <p v-else class="muted">{{ t("noWarnings") }}</p>
      <DataList v-if="pending.length" :value="pending" />
    </section>
  </div>
</template>
<style scoped>
.block {
  padding: 20px;
}
.block :deep(.heading) {
  margin-bottom: 14px;
}
.block :deep(button) {
  display: flex;
  align-items: center;
  gap: 6px;
}
.warning {
  color: var(--warning);
  font-weight: 700;
}
</style>
