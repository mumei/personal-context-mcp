<script setup lang="ts">
import { useDashboard } from "#webUi/composables/useDashboard";
import NoticeBanner from "#webUi/components/atoms/NoticeBanner.vue";
import RouteDiagnostics from "#webUi/components/molecules/RouteDiagnostics.vue";
import AppHeader from "#webUi/components/organisms/AppHeader.vue";
import AppSidebar from "#webUi/components/organisms/AppSidebar.vue";
import { useLocale } from "#webUi/composables/useLocale";
const { state } = useDashboard();
const { t } = useLocale();
</script>
<template>
  <div class="layout">
    <AppSidebar />
    <section class="workspace">
      <AppHeader /><RouteDiagnostics /><NoticeBanner :message="state.notice" @close="state.notice = ''" />
      <main :aria-busy="state.loading">
        <p v-if="state.loading" class="loading" role="status" aria-live="polite">{{ t("loading") }}</p>
        <p v-if="state.error" class="error" role="alert">{{ state.error }}</p>
        <slot />
      </main>
    </section>
  </div>
</template>
<style scoped>
.layout {
  display: grid;
  min-height: 100dvh;
  grid-template-columns: var(--sidebar-width) minmax(0, 1fr);
  background: var(--color-paper-2);
}
.workspace {
  min-width: 0;
}
.workspace main {
  width: min(100%, var(--content-max));
  margin-inline: auto;
  padding: var(--space-md);
}
.error {
  margin-block-end: var(--space-sm);
  padding: var(--space-xs) var(--space-sm);
  color: var(--danger);
  border: 1px solid var(--color-danger-rule);
  border-radius: var(--radius-surface);
  background: var(--color-danger-soft);
}
.loading {
  margin-block-end: var(--space-sm);
  color: var(--muted);
  font-size: var(--text-sm);
}
@media (max-width: 900px) {
  .layout {
    display: block;
  }
  .workspace main {
    padding: var(--space-xs) var(--space-xs) var(--space-lg);
  }
}
</style>
