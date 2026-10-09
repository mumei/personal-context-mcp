<script setup lang="ts">
import { nextTick, onMounted } from "vue";
import { useRoute } from "vue-router";
import { useDashboard } from "#webUi/composables/useDashboard";
import { useLocale } from "#webUi/composables/useLocale";
import SettingsPanel from "#webUi/components/organisms/SettingsPanel.vue";
const { state } = useDashboard();
const { t } = useLocale();
const route = useRoute();
onMounted(async () => {
  await nextTick();
  if (route.hash === "#weekly-report-settings")
    window.document.getElementById("weekly-report-settings")?.scrollIntoView();
});
</script>
<template>
  <div class="stack">
    <div class="page-heading">
      <div>
        <h2>{{ t("settings") }}</h2>
        <p>{{ t("settingsDescription") }}</p>
      </div>
    </div>
    <SettingsPanel @saved="state.notice = $event" />
  </div>
</template>
