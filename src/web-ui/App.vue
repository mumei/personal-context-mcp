<script setup lang="ts">
import { onMounted, watch } from "vue";
import { useRoute } from "vue-router";
import AuditLayout from "#webUi/components/templates/AuditLayout.vue";
import { useDashboard } from "#webUi/composables/useDashboard";
const route = useRoute();
const { loadOverview } = useDashboard();
onMounted(loadOverview);
watch(
  () => route.query.date,
  () => void loadOverview(),
);
</script>
<template>
  <AuditLayout><RouterView /></AuditLayout>
</template>
