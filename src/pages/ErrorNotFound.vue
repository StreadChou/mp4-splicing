<template>
  <div class="not-found full-height column flex-center q-pa-md">
    <q-card flat bordered class="not-found-card text-center q-pa-xl">
      <div class="code-text">404</div>
      <div class="text-h5 text-weight-bold text-teal-10 q-mt-sm">页面不存在</div>
      <div class="text-body2 text-grey-7 q-mt-sm">你访问的页面可能已被移动，或地址输入有误。</div>
      <q-btn class="q-mt-lg" color="primary" icon="home" unelevated to="/" label="返回首页" />
    </q-card>
  </div>
</template>

<script setup lang="ts">
//
</script>

<style scoped>
.not-found {
  background:
    radial-gradient(circle at 16% 0%, rgba(25, 193, 171, 0.18), rgba(255, 255, 255, 0) 44%),
    radial-gradient(circle at 84% 100%, rgba(255, 124, 92, 0.16), rgba(255, 255, 255, 0) 38%),
    linear-gradient(170deg, #e8f7f5 0%, #f5fbfa 44%, #fff6f1 100%);
}

.not-found-card {
  width: min(560px, 100%);
  border-radius: 20px;
  border-color: rgba(10, 74, 69, 0.16);
  background: rgba(255, 255, 255, 0.84);
  box-shadow: 0 16px 36px rgba(13, 79, 75, 0.12);
}

.code-text {
  font-size: clamp(72px, 18vw, 168px);
  line-height: 0.9;
  font-weight: 800;
  color: #0f9f93;
}
</style>
