<script setup lang="ts">
const props = defineProps<{ value: unknown; labels?: Record<string, string> }>();
function entries(value: unknown): Array<[string, unknown]> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.entries(value as Record<string, unknown>).filter(([, item]) => item != null)
    : [];
}
function values(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}
function labelFor(key: string): string {
  return props.labels?.[key] ?? key.replaceAll("_", " ");
}
</script>
<template>
  <dl v-if="entries(value).length" class="data-list">
    <div v-for="[key, item] in entries(value)" :key="key" class="row">
      <dt>{{ labelFor(key) }}</dt>
      <dd>
        <ul v-if="Array.isArray(item)">
          <li v-for="(line, index) in values(item)" :key="index">{{ line }}</li>
        </ul>
        <DataList v-else-if="item && typeof item === 'object'" :value="item" :labels="props.labels" /><span v-else>{{
          item
        }}</span>
      </dd>
    </div>
  </dl>
</template>
<style scoped>
.data-list {
  margin: 0;
}
.row {
  display: grid;
  grid-template-columns: minmax(110px, 180px) 1fr;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--line);
}
.row:last-child {
  border-bottom: 0;
}
dt {
  color: var(--muted);
  font-size: 12px;
  font-weight: 700;
}
dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}
ul {
  margin: 0;
  padding-left: 18px;
}
@media (max-width: 540px) {
  .row {
    grid-template-columns: 1fr;
    gap: 4px;
  }
}
</style>
