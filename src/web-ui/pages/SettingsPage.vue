<script setup lang="ts">
import { useDashboard } from "#webUi/composables/useDashboard";
import { useLocale } from "#webUi/composables/useLocale";
import SettingsPanel from "#webUi/components/organisms/SettingsPanel.vue";
const { state } = useDashboard();
const { t } = useLocale();
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
