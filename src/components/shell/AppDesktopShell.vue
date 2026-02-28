<template>
  <div class="app-shell" :style="paneVars">
    <header class="app-shell-titlebar drag-region" @dblclick="handleTitlebarDoubleClick">
      <div class="titlebar-side">
        <slot name="titlebar-left" />
      </div>
      <div class="titlebar-center">
        <slot name="titlebar-center">
          <div class="titlebar-text">{{ title }}</div>
        </slot>
      </div>
      <div class="titlebar-side titlebar-side-end">
        <slot name="titlebar-right" />
      </div>
    </header>

    <div class="app-shell-body" :class="{ 'no-middle': !showMiddle }">
      <aside class="shell-pane shell-left">
        <slot name="left" />
      </aside>
      <aside v-if="showMiddle" class="shell-pane shell-middle">
        <slot name="middle" />
      </aside>
      <main class="shell-pane shell-right">
        <slot name="right" />
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { windowToggleMaximize } from "src/tauri-compat/core";

const props = withDefaults(defineProps<{
  title?: string;
  showMiddle?: boolean;
  leftWidth?: number;
  middleWidth?: number;
}>(), {
  title: "",
  showMiddle: true,
  leftWidth: 88,
  middleWidth: 320,
});

const paneVars = computed(() => ({
  "--shell-left-width": `${String(props.leftWidth)}px`,
  "--shell-middle-width": `${String(props.middleWidth)}px`,
}));

function handleTitlebarDoubleClick() {
  void windowToggleMaximize();
}
</script>

<style scoped>
.app-shell {
  height: 100vh;
  width: 100%;
  color: #062b29;
  background:
    radial-gradient(circle at 20% 0%, rgba(25, 193, 171, 0.16), rgba(255, 255, 255, 0) 40%),
    radial-gradient(circle at 85% 100%, rgba(255, 124, 92, 0.14), rgba(255, 255, 255, 0) 36%),
    linear-gradient(160deg, #e8f7f5 0%, #f5fbfa 44%, #fff6f1 100%);
}

.app-shell-titlebar {
  height: 42px;
  border-bottom: 1px solid rgba(6, 43, 41, 0.08);
  display: grid;
  grid-template-columns: 180px 1fr 180px;
  align-items: center;
  padding: 0 8px;
  background: rgba(255, 255, 255, 0.62);
  backdrop-filter: blur(16px);
}

.titlebar-side {
  min-width: 0;
  display: flex;
  align-items: center;
}

.titlebar-side-end {
  justify-content: flex-end;
}

.titlebar-center {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.titlebar-text {
  font-size: 13px;
  font-weight: 700;
  color: rgba(6, 43, 41, 0.82);
  letter-spacing: 0.3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.app-shell-body {
  height: calc(100vh - 42px);
  display: grid;
  grid-template-columns: var(--shell-left-width) minmax(0, var(--shell-middle-width)) minmax(0, 1fr);
}

.app-shell-body.no-middle {
  grid-template-columns: var(--shell-left-width) minmax(0, 1fr);
}

.shell-pane {
  min-height: 0;
  min-width: 0;
}

.shell-left {
  border-right: 1px solid rgba(6, 43, 41, 0.08);
  background: rgba(255, 255, 255, 0.75);
  backdrop-filter: blur(8px);
}

.shell-middle {
  border-right: 1px solid rgba(6, 43, 41, 0.08);
  background: rgba(248, 255, 254, 0.72);
  backdrop-filter: blur(8px);
}

.shell-right {
  background: rgba(255, 255, 255, 0.68);
  backdrop-filter: blur(8px);
}

.drag-region {
  -webkit-app-region: drag;
  user-select: none;
}

.drag-region :deep(.no-drag),
.drag-region :deep(.q-btn),
.drag-region :deep(button),
.drag-region :deep(input),
.drag-region :deep(textarea),
.drag-region :deep(select) {
  -webkit-app-region: no-drag;
}

@media (max-width: 1140px) {
  .app-shell-body {
    grid-template-columns: 76px 280px minmax(0, 1fr);
  }
}

@media (max-width: 920px) {
  .app-shell-body {
    display: flex;
    flex-direction: column;
    height: auto;
    min-height: calc(100vh - 42px);
  }

  .shell-left,
  .shell-middle,
  .shell-right {
    border-right: none;
    border-bottom: 1px solid rgba(6, 43, 41, 0.08);
  }

  .shell-right {
    border-bottom: none;
    flex: 1;
  }
}
</style>
