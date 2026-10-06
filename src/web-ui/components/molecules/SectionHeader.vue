<script setup lang="ts">
defineProps<{ title: string; description?: string }>();
</script>
<template>
  <div class="heading">
    <div>
      <h3>{{ title }}</h3>
      <p v-if="description">{{ description }}</p>
    </div>
    <div class="actions"><slot /></div>
  </div>
</template>
<style scoped>
.heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
h3 {
  margin: 0;
  font-size: 17px;
}
p {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 13px;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
@media (max-width: 560px) {
  .heading {
    flex-direction: column;
  }
  .actions {
    width: 100%;
  }
}
</style>
