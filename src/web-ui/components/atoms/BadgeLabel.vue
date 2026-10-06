<template>
  <span class="badge"><slot /></span>
</template>
<style scoped>
.badge {
  display: inline-flex;
  align-items: center;
  min-height: 20px;
  padding: 2px 7px;
  border: 1px solid var(--color-rule-strong);
  border-radius: 4px;
  font-size: 11px;
  font-weight: 650;
  line-height: 1;
}
</style>
