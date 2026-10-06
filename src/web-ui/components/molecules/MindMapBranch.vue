<script setup lang="ts">
interface MindMapNode {
  label?: string;
  children?: MindMapNode[];
}
defineProps<{ node: MindMapNode }>();
</script>
<template>
  <li>
    <span>{{ node.label }}</span>
    <ul v-if="node.children?.length">
      <MindMapBranch v-for="(child, index) in node.children" :key="index" :node="child" />
    </ul>
  </li>
</template>
<style scoped>
li {
  position: relative;
  list-style: none;
}
span {
  display: inline-block;
  min-width: 130px;
  max-width: 220px;
  padding: 9px 11px;
  border: 1px solid var(--color-rule-strong);
  border-left: 4px solid var(--accent);
  border-radius: var(--radius-control);
  background: var(--color-paper);
  overflow-wrap: anywhere;
}
ul {
  display: grid;
  gap: 10px;
  margin: 8px 0 0 20px;
  padding-left: 18px;
  border-left: 1px solid var(--color-rule-strong);
}
</style>
