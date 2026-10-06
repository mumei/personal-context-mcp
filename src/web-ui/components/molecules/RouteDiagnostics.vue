<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { useLocale } from "#webUi/composables/useLocale";
import { readWebRequestContext } from "#webUi/navigation/requestContext";

const route = useRoute();
const { t } = useLocale();
const requestContext = readWebRequestContext();
const browserLocation = computed(() => {
  void route.fullPath;
  return {
    href: window.location.href,
    pathname: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash,
  };
});
const routeMatches = computed(
  () =>
    requestContext?.requested_path === browserLocation.value.pathname &&
    requestContext.requested_search === browserLocation.value.search,
);
</script>

<template>
  <aside v-if="requestContext?.route_debug" class="route-diagnostics" role="status">
    <div class="diagnostic-heading">
      <strong>{{ t("routeDiagnostics") }}</strong>
      <span :class="routeMatches ? 'match' : 'mismatch'">{{ t(routeMatches ? "routeMatch" : "routeMismatch") }}</span>
    </div>
    <dl>
      <dt>{{ t("serverRequestedRoute") }}</dt>
      <dd>
        <code>{{ requestContext.requested_route }}</code>
      </dd>
      <dt>Browser href</dt>
      <dd>
        <code>{{ browserLocation.href }}</code>
      </dd>
      <dt>Browser pathname</dt>
      <dd>
        <code>{{ browserLocation.pathname }}</code>
      </dd>
      <dt>Browser search</dt>
      <dd>
        <code>{{ browserLocation.search || "(empty)" }}</code>
      </dd>
      <dt>Browser hash</dt>
      <dd>
        <code>{{ browserLocation.hash || "(empty)" }}</code>
      </dd>
      <dt>Vue Router fullPath</dt>
      <dd>
        <code>{{ route.fullPath }}</code>
      </dd>
    </dl>
  </aside>
</template>

<style scoped>
.route-diagnostics {
  padding: 12px 20px;
  border-bottom: 1px solid var(--color-warning-rule);
  color: var(--color-ink);
  background: var(--color-warning-soft);
}
.diagnostic-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.diagnostic-heading span {
  padding: 3px 7px;
  border: 1px solid currentColor;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 700;
}
.diagnostic-heading .match {
  color: var(--color-success);
}
.diagnostic-heading .mismatch {
  color: var(--color-danger);
}
dl {
  display: grid;
  margin: 10px 0 0;
  grid-template-columns: 150px minmax(0, 1fr);
  gap: 5px 10px;
  font-size: 12px;
}
dt {
  color: var(--color-warning);
  font-weight: 700;
}
dd {
  min-width: 0;
  margin: 0;
}
code {
  display: block;
  overflow-wrap: anywhere;
  white-space: normal;
}
@media (max-width: 760px) {
  .route-diagnostics {
    padding: 10px 12px;
  }
  dl {
    grid-template-columns: 1fr;
    gap: 2px;
  }
  dd + dt {
    margin-top: 6px;
  }
}
</style>
