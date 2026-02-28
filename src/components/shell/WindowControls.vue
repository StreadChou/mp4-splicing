<template>
  <div class="window-controls no-drag" :class="isMac ? 'controls-mac' : 'controls-win'">
    <template v-if="isMac">
      <button class="dot dot-close" aria-label="关闭" @click="onClose" />
      <button class="dot dot-min" aria-label="最小化" @click="onMinimize" />
      <button class="dot dot-max" :aria-label="maximized ? '还原' : '最大化'" @click="onToggleMaximize" />
    </template>

    <template v-else>
      <q-btn flat dense icon="remove" aria-label="最小化" @click="onMinimize" />
      <q-btn flat dense :icon="maximized ? 'filter_none' : 'crop_square'" :aria-label="maximized ? '还原' : '最大化'" @click="onToggleMaximize" />
      <q-btn flat dense icon="close" aria-label="关闭" class="win-close" @click="onClose" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { useQuasar } from "quasar";
import { windowClose, windowIsMaximized, windowMinimize, windowToggleMaximize } from "src/tauri-compat/core";
import { listen, type UnlistenFn } from "src/tauri-compat/event";

const $q = useQuasar();
const isMac = $q.platform.is.mac;
const maximized = ref(false);
let unlistenWindowState: UnlistenFn | null = null;

async function syncMaximizedState() {
  try {
    maximized.value = await windowIsMaximized();
  } catch {
    maximized.value = false;
  }
}

async function onMinimize() {
  await windowMinimize();
}

async function onToggleMaximize() {
  await windowToggleMaximize();
  await syncMaximizedState();
}

async function onClose() {
  await windowClose();
}

onMounted(async () => {
  await syncMaximizedState();
  unlistenWindowState = await listen<{ maximized?: boolean }>("window:state", (event) => {
    maximized.value = event.payload?.maximized === true;
  });
});

onUnmounted(() => {
  if (unlistenWindowState) {
    unlistenWindowState();
    unlistenWindowState = null;
  }
});
</script>

<style scoped>
.window-controls {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.controls-mac {
  padding-left: 6px;
}

.dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  transition: transform 0.12s ease, filter 0.12s ease;
}

.dot:hover {
  transform: scale(1.08);
  filter: saturate(1.1);
}

.dot-close {
  background: #ff5f57;
}

.dot-min {
  background: #febc2e;
}

.dot-max {
  background: #28c840;
}

.controls-win {
  gap: 0;
}

.controls-win :deep(.q-btn) {
  min-width: 42px;
  height: 30px;
  border-radius: 8px;
  color: #0a4a45;
}

.controls-win :deep(.q-btn:hover) {
  background: rgba(10, 74, 69, 0.1);
}

.controls-win :deep(.win-close:hover) {
  background: rgba(211, 47, 47, 0.16);
  color: #b91c1c;
}
</style>
