<template>
  <q-layout view="hHh lpR fFf" class="main-layout">
    <q-page-container>
      <router-view />
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
// 该布局仅保留兜底路由容器，主视觉由各页面自行控制。
</script>

<style scoped>
.main-layout {
  background:
    radial-gradient(circle at 14% 0%, rgba(25, 193, 171, 0.14), rgba(255, 255, 255, 0) 42%),
    radial-gradient(circle at 85% 100%, rgba(255, 124, 92, 0.12), rgba(255, 255, 255, 0) 36%),
    linear-gradient(170deg, #e8f7f5 0%, #f5fbfa 46%, #fff6f1 100%);
}
</style>
