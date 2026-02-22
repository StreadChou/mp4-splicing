<template>
  <q-layout view="hHh lpR fFf" class="index-layout">
    <q-header elevated class="index-header text-white">
      <q-toolbar>
        <q-toolbar-title>
          <q-icon name="account_tree" size="sm" class="q-mr-sm" />
          MP4 工作流平台
        </q-toolbar-title>
      </q-toolbar>
    </q-header>

    <q-drawer :model-value="true" show-if-above :width="220" :breakpoint="0" bordered class="index-drawer">
      <q-list padding>
        <q-item-label header class="text-weight-bold text-grey-4">功能菜单</q-item-label>

        <q-item
          clickable
          v-ripple
          :active="activeTab === 'workflows'"
          @click="activeTab = 'workflows'"
          active-class="menu-item-active"
          class="menu-item rounded-borders q-mb-xs"
        >
          <q-item-section avatar>
            <q-icon name="schema" />
          </q-item-section>
          <q-item-section>工作流管理</q-item-section>
        </q-item>

        <q-item
          clickable
          v-ripple
          :active="activeTab === 'tasks'"
          @click="activeTab = 'tasks'"
          active-class="menu-item-active"
          class="menu-item rounded-borders q-mb-xs"
        >
          <q-item-section avatar>
            <q-icon name="task" />
          </q-item-section>
          <q-item-section>任务管理</q-item-section>
          <q-item-section side>
            <q-badge v-if="waitingCount > 0" color="negative" rounded>{{ waitingCount }}</q-badge>
          </q-item-section>
        </q-item>
      </q-list>
    </q-drawer>

    <q-page-container>
      <q-page padding>
        <WorkflowManager v-show="activeTab === 'workflows'" />
        <TaskManager ref="taskManagerRef" v-show="activeTab === 'tasks'" @waiting-count="waitingCount = $event" />
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import WorkflowManager from "src/components/workflow/WorkflowManager.vue";
import TaskManager from "src/components/workflow/TaskManager.vue";
import { listen, type UnlistenFn } from "src/tauri-compat/event";

const activeTab = ref<"workflows" | "tasks">("workflows");
const waitingCount = ref(0);
const taskManagerRef = ref<InstanceType<typeof TaskManager> | null>(null);
let unlistenOpenTask: UnlistenFn | null = null;

function handleRunCreated(taskId: string) {
  activeTab.value = "tasks";
  void taskManagerRef.value?.refreshTasks();
  void taskManagerRef.value?.selectTask(taskId);
}

onMounted(async () => {
  unlistenOpenTask = await listen<{ taskId?: string }>("ui:open-task", (event) => {
    const taskId = typeof event.payload?.taskId === "string" ? event.payload.taskId : "";
    if (taskId) {
      handleRunCreated(taskId);
      return;
    }
    activeTab.value = "tasks";
  });
});

onUnmounted(() => {
  if (unlistenOpenTask) {
    unlistenOpenTask();
    unlistenOpenTask = null;
  }
});
</script>

<style scoped>
.index-layout {
  background: #020617;
}

.index-header {
  background: linear-gradient(90deg, #111827 0%, #0f172a 100%);
  border-bottom: 1px solid #243043;
}

.index-drawer {
  background: #0b1220;
  border-right: 1px solid #243043;
  color: #e5e7eb;
}

.menu-item {
  color: #cbd5e1;
  background: #111827;
}

.menu-item-active {
  background: #1e293b;
  color: #f8fafc;
}
</style>
