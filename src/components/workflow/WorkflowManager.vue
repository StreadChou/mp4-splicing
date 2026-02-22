<template>
  <div class="workflow-manager">
    <q-card flat bordered class="manager-card">
      <q-card-section class="row items-center q-gutter-sm">
        <div class="text-h6">工作流管理</div>
        <q-space />
        <q-btn
          flat
          color="warning"
          icon="restart_alt"
          label="一键还原默认"
          @click="restoreAllWorkflows"
        />
        <q-btn flat dense icon="refresh" @click="loadWorkflows">
          <q-tooltip>刷新工作流列表</q-tooltip>
        </q-btn>
        <q-btn color="primary" icon="add" label="新建工作流" @click="openEditor()" />
      </q-card-section>

      <q-separator dark />

      <q-list separator>
        <q-item
          v-for="workflow in workflows"
          :key="workflow.id"
          clickable
          v-ripple
          :active="workflow.id === selectedId"
          active-class="workflow-item-active"
          class="workflow-item"
          @click="selectedId = workflow.id"
          @dblclick="openEditor(workflow.id)"
        >
          <q-item-section>
            <q-item-label>{{ workflow.name }}</q-item-label>
            <q-item-label caption :class="workflow.id === selectedId ? 'text-white' : ''">
              {{ workflow.description || '无描述' }}
            </q-item-label>
          </q-item-section>

          <q-item-section side>
            <div class="row items-center q-gutter-xs">
              <q-chip dense :color="workflow.source === 'system' ? 'blue-2' : 'green-2'" text-color="dark">
                {{ workflow.source === 'system' ? '内置' : '自定义' }}
              </q-chip>

              <q-btn flat dense round icon="edit" @click.stop="openEditor(workflow.id)">
                <q-tooltip>编辑（新窗口）</q-tooltip>
              </q-btn>

              <q-btn flat dense round icon="content_copy" @click.stop="duplicateWorkflow(workflow.id)">
                <q-tooltip>另存为副本</q-tooltip>
              </q-btn>

              <q-btn
                v-if="workflow.source === 'system'"
                flat
                dense
                round
                icon="restart_alt"
                color="warning"
                @click.stop="restoreWorkflow(workflow.id)"
              >
                <q-tooltip>还原默认</q-tooltip>
              </q-btn>

              <q-btn
                v-if="workflow.source !== 'system' && !workflow.readonly"
                flat
                dense
                round
                icon="delete"
                color="negative"
                @click.stop="removeWorkflow(workflow.id)"
              >
                <q-tooltip>删除</q-tooltip>
              </q-btn>
            </div>
          </q-item-section>
        </q-item>
      </q-list>

      <q-separator dark />

      <q-card-section>
        <q-banner v-if="errorMsg" class="bg-negative text-white" rounded>
          {{ errorMsg }}
        </q-banner>
        <div v-else class="text-caption text-grey-5">
          提示：双击列表项或点击编辑按钮，会在新窗口以最大化模式打开可视化蓝图编辑页。
        </div>
      </q-card-section>
    </q-card>

  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import {
  deleteWorkflow,
  duplicateWorkflow as duplicateWorkflowApi,
  listWorkflows,
  restoreAllWorkflowDefaults,
  restoreWorkflowDefault,
} from "src/api/workflow-api";
import { openWorkflowEditor } from "src/tauri-compat/core";
import type { WorkflowMeta } from "./types";

const workflows = ref<WorkflowMeta[]>([]);
const selectedId = ref("");
const errorMsg = ref("");
let refreshTimer: ReturnType<typeof setInterval> | null = null;

async function loadWorkflows() {
  workflows.value = await listWorkflows();
  if (!selectedId.value && workflows.value.length > 0) {
    selectedId.value = workflows.value[0]?.id || "";
  }
}

async function openEditor(workflowId?: string) {
  errorMsg.value = "";
  try {
    await openWorkflowEditor(workflowId);
  } catch (error) {
    errorMsg.value = String(error);
  }
}

async function duplicateWorkflow(workflowId: string) {
  errorMsg.value = "";
  try {
    const duplicated = await duplicateWorkflowApi(workflowId);
    await loadWorkflows();
    selectedId.value = duplicated.id;
  } catch (error) {
    errorMsg.value = String(error);
  }
}

async function removeWorkflow(workflowId: string) {
  errorMsg.value = "";
  try {
    await deleteWorkflow(workflowId);
    if (selectedId.value === workflowId) {
      selectedId.value = "";
    }
    await loadWorkflows();
  } catch (error) {
    errorMsg.value = String(error);
  }
}

async function restoreWorkflow(workflowId: string) {
  errorMsg.value = "";
  try {
    await restoreWorkflowDefault(workflowId);
    await loadWorkflows();
  } catch (error) {
    errorMsg.value = String(error);
  }
}

async function restoreAllWorkflows() {
  errorMsg.value = "";
  if (!window.confirm("将还原所有内置工作流为默认图，是否继续？")) {
    return;
  }
  try {
    await restoreAllWorkflowDefaults();
    await loadWorkflows();
  } catch (error) {
    errorMsg.value = String(error);
  }
}

onMounted(async () => {
  await loadWorkflows();
  refreshTimer = setInterval(() => {
    void loadWorkflows();
  }, 3000);
});

onUnmounted(() => {
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }
});
</script>

<style scoped>
.workflow-manager {
  min-height: calc(100vh - 120px);
}

.manager-card {
  background: #111827;
  border-color: #243043;
  color: #e5e7eb;
}

.workflow-item {
  margin: 6px 10px;
  border-radius: 10px;
  background: #0f172a;
}

.workflow-item-active {
  background: #1e293b;
  color: #f8fafc;
}
</style>
