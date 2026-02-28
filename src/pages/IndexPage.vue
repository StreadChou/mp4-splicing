<template>
  <AppDesktopShell title="MP4 工作流平台" :show-middle="true" :left-width="88" :middle-width="320">
    <template #titlebar-left>
      <WindowControls v-if="isMac" />
    </template>

    <template #titlebar-center>
      <div class="titlebar-brand">
        <q-icon name="movie_creation" size="18px" class="q-mr-xs" />
        <span>MP4 工作流平台</span>
        <q-badge color="teal-2" text-color="teal-10" class="q-ml-sm">{{ activeTabLabel }}</q-badge>
      </div>
    </template>

    <template #titlebar-right>
      <WindowControls v-if="!isMac" />
    </template>

    <template #left>
      <div class="left-nav column items-center full-height">
        <div class="q-pt-md column items-center q-gutter-sm">
          <q-btn
            round
            unelevated
            :class="['nav-btn', { 'nav-btn-active': activeTab === 'workflows' }]"
            icon="schema"
            @click="activeTab = 'workflows'"
          >
            <q-tooltip>工作流管理</q-tooltip>
          </q-btn>

          <q-btn
            round
            unelevated
            :class="['nav-btn', { 'nav-btn-active': activeTab === 'tasks' }]"
            icon="task"
            @click="activeTab = 'tasks'"
          >
            <q-tooltip>任务管理</q-tooltip>
            <q-badge v-if="waitingCount > 0" floating rounded color="negative">{{ waitingCount }}</q-badge>
          </q-btn>
        </div>

        <q-space />

        <div class="q-pb-md">
          <q-btn
            round
            unelevated
            :class="['nav-btn', { 'nav-btn-active': activeTab === 'settings' }]"
            icon="settings"
            @click="activeTab = 'settings'"
          >
            <q-tooltip>系统设置</q-tooltip>
          </q-btn>
        </div>
      </div>
    </template>

    <template #middle>
      <div class="middle-pane">
        <div v-if="activeTab === 'workflows'" class="pane-block">
          <div class="pane-header row items-center">
            <div class="pane-title">工作流列表</div>
            <q-space />
            <q-btn flat dense color="warning" icon="restart_alt" label="还原全部默认" @click="restoreAllSystemWorkflows">
              <q-tooltip>将所有内置工作流恢复为默认内容</q-tooltip>
            </q-btn>
          </div>

          <q-scroll-area class="pane-scroll">
            <q-list class="workflow-list q-pa-sm">
              <q-item
                v-for="workflow in workflows"
                :key="workflow.id"
                clickable
                :active="workflow.id === selectedWorkflowId"
                active-class="workflow-item-active"
                class="workflow-item"
                @click="attemptSelectWorkflow(workflow.id)"
                @dblclick="openEditor(workflow.id)"
              >
                <q-item-section>
                  <q-item-label class="text-weight-medium">{{ workflow.name }}</q-item-label>
                  <q-item-label caption>{{ workflow.source === 'system' ? '内置工作流' : '自定义工作流' }}</q-item-label>
                </q-item-section>
                <q-item-section side>
                  <q-chip dense :color="workflow.source === 'system' ? 'cyan-2' : 'orange-2'" text-color="grey-10">
                    {{ workflow.source === 'system' ? '内置' : '自定义' }}
                  </q-chip>
                </q-item-section>
                <q-tooltip>{{ workflow.description || '无备注' }}</q-tooltip>
              </q-item>
            </q-list>
          </q-scroll-area>
        </div>

        <div v-else-if="activeTab === 'tasks'" class="pane-block">
          <div class="pane-header column items-stretch q-gutter-sm">
            <div class="row items-center">
              <div class="pane-title">任务列表</div>
              <q-space />
              <q-btn flat dense round icon="refresh" @click="loadTasks">
                <q-tooltip>刷新任务</q-tooltip>
              </q-btn>
            </div>

            <q-btn-toggle
              v-model="taskFilter"
              spread
              dense
              unelevated
              toggle-color="primary"
              color="grey-3"
              text-color="grey-8"
              :options="taskFilterOptions"
            />
          </div>

          <q-scroll-area class="pane-scroll">
            <q-list class="task-list q-pa-sm">
              <q-item
                v-for="task in filteredTasks"
                :key="task.id"
                clickable
                :active="task.id === selectedTaskId"
                active-class="task-item-active"
                class="task-item"
                @click="selectTask(task.id)"
              >
                <q-item-section>
                  <q-item-label class="text-weight-medium">{{ task.workflowName }}</q-item-label>
                  <q-item-label caption>{{ formatDate(task.createdAt) }}</q-item-label>
                </q-item-section>
                <q-item-section side>
                  <q-chip dense :color="statusColor(task.status)" text-color="white">{{ task.status }}</q-chip>
                </q-item-section>
              </q-item>
              <q-item v-if="filteredTasks.length === 0">
                <q-item-section>
                  <q-item-label class="text-grey-6">当前筛选条件下没有任务</q-item-label>
                </q-item-section>
              </q-item>
            </q-list>
          </q-scroll-area>
        </div>

        <div v-else class="pane-block">
          <div class="pane-header row items-center">
            <div class="pane-title">设置分项</div>
          </div>
          <q-list class="q-pa-sm">
            <q-item clickable :active="settingCatalog === 'directory'" active-class="setting-item-active" class="setting-item" @click="settingCatalog = 'directory'">
              <q-item-section avatar>
                <q-icon name="folder" color="teal-8" />
              </q-item-section>
              <q-item-section>
                <q-item-label>目录设置</q-item-label>
                <q-item-label caption>临时目录与运行目录相关配置</q-item-label>
              </q-item-section>
            </q-item>
          </q-list>
        </div>
      </div>
    </template>

    <template #right>
      <div v-if="activeTab === 'workflows'" class="right-pane">
        <div class="right-header row items-center q-gutter-sm">
          <div class="text-subtitle1 text-weight-bold">{{ selectedWorkflow?.name || '未选择工作流' }}</div>
          <q-chip v-if="selectedWorkflow" dense :color="selectedWorkflow.source === 'system' ? 'cyan-2' : 'orange-2'" text-color="grey-10">
            {{ selectedWorkflow.source === 'system' ? '内置' : '自定义' }}
          </q-chip>
          <q-chip dense :color="workflowDraftDirty ? 'orange-2' : 'teal-1'" text-color="grey-10">
            {{ workflowDraftDirty ? '草稿已修改' : '使用已保存配置' }}
          </q-chip>
          <q-space />

          <q-btn flat icon="edit" label="编辑" :disable="!selectedWorkflow" @click="openEditor(selectedWorkflowId)" />
          <q-btn flat icon="content_copy" label="另存为" :disable="!selectedWorkflow" @click="duplicateSelectedWorkflow" />
          <q-btn
            v-if="selectedWorkflow?.source === 'user'"
            flat
            color="negative"
            icon="delete"
            label="删除"
            :disable="!selectedWorkflow"
            @click="removeSelectedWorkflow"
          />
          <q-btn
            v-if="selectedWorkflow?.source === 'system'"
            flat
            color="warning"
            icon="restart_alt"
            label="还原默认"
            :disable="!selectedWorkflow"
            @click="restoreSelectedWorkflow"
          />
          <q-btn color="primary" icon="play_arrow" label="运行" :disable="!selectedWorkflow" @click="runSelectedWorkflow" />
        </div>

        <q-separator class="q-my-sm" />

        <q-banner v-if="workflowErrorMsg" rounded class="bg-negative text-white q-mb-sm">
          {{ workflowErrorMsg }}
        </q-banner>

        <div v-if="selectedWorkflowDef" class="workflow-right-content">
          <SystemWorkflowBoard
            v-if="selectedWorkflow?.source === 'system'"
            :system-kind="selectedWorkflowDef.systemKind"
            :graph="workflowDraftGraph"
            @update-field="handleWorkflowBoardUpdate"
            @pick-path="handleWorkflowBoardPickPath"
          />

          <div v-else class="canvas-wrapper">
            <WorkflowBlueprintEditor
              v-model="workflowDraftGraph"
              canvas-mode="canvas-only"
              feature-level="complete"
              @run-from-canvas="runSelectedWorkflow"
              @graph-dirty-change="onWorkflowDraftDirtyChange"
            />
          </div>
        </div>
      </div>

      <div v-else-if="activeTab === 'tasks'" class="right-pane q-pa-md">
        <q-card flat bordered class="detail-card">
          <q-card-section v-if="taskDetail" class="q-gutter-md">
            <q-card flat bordered class="inner-block">
              <q-card-section class="row items-center q-gutter-sm">
                <div class="text-h6 text-weight-medium">{{ taskDetail.task.workflowName }}</div>
                <q-chip dense :color="statusColor(taskDetail.task.status)" text-color="white">
                  {{ taskDetail.task.status }}
                </q-chip>
                <q-space />
                <q-btn
                  dense
                  flat
                  icon="cancel"
                  label="取消"
                  color="warning"
                  :disable="cannotCancel(taskDetail.task.status)"
                  @click="cancelTask"
                />
                <q-btn
                  dense
                  unelevated
                  icon="delete"
                  label="移除任务"
                  color="negative"
                  :loading="removingTaskIds.includes(taskDetail.task.id)"
                  @click="removeSingleTask(taskDetail.task.id)"
                />
              </q-card-section>

              <q-separator />

              <q-card-section class="q-gutter-sm text-caption text-grey-8">
                <div>当前节点：{{ currentNodeText }}</div>
                <div>已完成节点：{{ graphDoneCount }}/{{ graphTotalCount }}（{{ graphPercent }}%）</div>
                <div>执行阶段：{{ graphPhaseText }}</div>
                <div>运行目录：{{ taskDetail.task.runDir }}</div>
                <div v-if="taskDetail.task.error" class="text-negative">错误：{{ taskDetail.task.error }}</div>
              </q-card-section>
            </q-card>

            <q-card flat bordered class="inner-block">
              <q-card-section class="row items-center q-gutter-sm">
                <div class="text-subtitle1 text-weight-medium">流程执行进度</div>
                <q-space />
                <q-chip dense color="primary" text-color="white">{{ graphDoneCount }}/{{ graphTotalCount }}</q-chip>
                <q-chip dense color="grey-3" text-color="grey-8">{{ graphPhaseText }}</q-chip>
              </q-card-section>

              <q-separator />

              <q-card-section v-if="taskGraphNodes.length > 0" class="q-pa-none">
                <div class="task-graph-wrap">
                  <VueFlow
                    :nodes="taskGraphNodes"
                    :edges="taskGraphEdges"
                    class="task-progress-flow"
                    :default-edge-options="taskEdgeOptions"
                    :connection-line-type="ConnectionLineType.Bezier"
                    :nodes-draggable="false"
                    :nodes-connectable="false"
                    :edges-updatable="false"
                    :elements-selectable="true"
                    :fit-view-on-init="true"
                    :pan-on-drag="true"
                    :zoom-on-scroll="true"
                    :zoom-on-pinch="true"
                    :min-zoom="0.2"
                    :max-zoom="2"
                    @node-click="onProgressNodeClick"
                    @pane-click="clearLogFilter"
                  >
                    <Background pattern-color="#9acfc7" :gap="20" />
                  </VueFlow>
                </div>
              </q-card-section>
              <q-card-section v-else class="text-caption text-grey-6">
                当前任务暂无流程图快照
              </q-card-section>
              <q-card-section class="text-caption text-grey-6 q-pt-sm">
                点击流程节点可只看该节点日志，点击空白区域恢复“全部日志”。
              </q-card-section>
            </q-card>

            <q-card v-if="taskDetail.interactionRequest" flat bordered class="inner-block">
              <q-card-section class="q-gutter-sm">
                <div class="text-subtitle1 text-warning">
                  <q-icon name="notification_important" class="q-mr-xs" />
                  待人工处理：{{ taskDetail.interactionRequest.title }}
                </div>
                <div class="text-caption text-grey-7">{{ taskDetail.interactionRequest.description }}</div>

                <div v-for="field in taskDetail.interactionRequest.formSchema" :key="field.id" class="q-mt-sm">
                  <q-input
                    v-if="field.type === 'text' || field.type === 'json'"
                    v-model="interactionForm[field.id]"
                    :label="field.label"
                    outlined
                    :placeholder="field.placeholder"
                  />

                  <q-input
                    v-else-if="field.type === 'textarea'"
                    v-model="interactionForm[field.id]"
                    type="textarea"
                    autogrow
                    :label="field.label"
                    outlined
                    :placeholder="field.placeholder"
                  />

                  <q-input
                    v-else-if="field.type === 'number'"
                    v-model.number="interactionForm[field.id]"
                    type="number"
                    :label="field.label"
                    outlined
                  />

                  <q-select
                    v-else-if="field.type === 'select'"
                    v-model="interactionForm[field.id]"
                    :label="field.label"
                    :options="field.options || []"
                    option-label="label"
                    option-value="value"
                    emit-value
                    map-options
                    outlined
                  />

                  <q-checkbox
                    v-else-if="field.type === 'boolean'"
                    v-model="interactionForm[field.id]"
                    :label="field.label"
                    color="primary"
                  />
                </div>

                <q-btn color="primary" icon="play_arrow" label="提交并继续" @click="resumeTask" />
              </q-card-section>
            </q-card>

            <q-card flat bordered class="inner-block">
              <q-card-section>
                <div class="row items-center q-gutter-sm q-mb-sm">
                  <div class="text-subtitle1 text-weight-medium">任务日志</div>
                  <q-chip
                    dense
                    clickable
                    :color="selectedLogNodeId ? 'grey-3' : 'primary'"
                    :text-color="selectedLogNodeId ? 'grey-9' : 'white'"
                    @click="clearLogFilter"
                  >
                    全部({{ taskDetail.logs.length }})
                  </q-chip>
                  <q-chip
                    v-if="selectedLogNodeId"
                    dense
                    clickable
                    color="amber-8"
                    text-color="white"
                    @click="clearLogFilter"
                  >
                    {{ selectedLogNodeText }} ({{ filteredTaskLogs.length }})
                  </q-chip>
                </div>
                <q-scroll-area style="height: 320px" class="task-log-area">
                  <q-list dense>
                    <q-item v-for="(log, idx) in filteredTaskLogs" :key="idx">
                      <q-item-section>
                        <q-item-label caption class="text-grey-7">
                          {{ formatDate(log.timestamp) }} [{{ log.level }}]
                          <span v-if="log.nodeLabel" class="text-amber-8"> · {{ log.nodeLabel }}</span>
                        </q-item-label>
                        <q-item-label class="text-grey-9">{{ log.message }}</q-item-label>
                      </q-item-section>
                    </q-item>
                    <q-item v-if="filteredTaskLogs.length === 0">
                      <q-item-section>
                        <q-item-label class="text-grey-6">当前筛选条件下暂无日志</q-item-label>
                      </q-item-section>
                    </q-item>
                  </q-list>
                </q-scroll-area>
              </q-card-section>
            </q-card>
          </q-card-section>

          <q-card-section v-else>
            <div class="empty-state">请选择左侧任务查看详情</div>
          </q-card-section>

          <q-banner v-if="taskErrorMsg" rounded dense class="bg-negative text-white q-ma-md">
            {{ taskErrorMsg }}
          </q-banner>
        </q-card>
      </div>

      <div v-else class="right-pane q-pa-md">
        <SystemSettingsPanel v-if="settingCatalog === 'directory'" />
      </div>
    </template>
  </AppDesktopShell>
</template>

<script setup lang="ts">
import { Background } from "@vue-flow/background";
import { ConnectionLineType, type Edge, type Node, VueFlow } from "@vue-flow/core";
import { useQuasar } from "quasar";
import { computed, onMounted, onUnmounted, ref } from "vue";
import { getTask, listTasks, removeTask as removeTaskApi, subscribeTasks, resumeTask as resumeTaskApi, cancelTask as cancelTaskApi } from "src/api/task-api";
import {
  deleteWorkflow,
  duplicateWorkflow as duplicateWorkflowApi,
  getWorkflow,
  listWorkflows,
  restoreAllWorkflowDefaults,
  restoreWorkflowDefault,
  runWorkflow as runWorkflowApi,
} from "src/api/workflow-api";
import AppDesktopShell from "src/components/shell/AppDesktopShell.vue";
import WindowControls from "src/components/shell/WindowControls.vue";
import WorkflowBlueprintEditor from "src/components/workflow/WorkflowBlueprintEditor.vue";
import SystemSettingsPanel from "src/components/workflow/SystemSettingsPanel.vue";
import SystemWorkflowBoard from "src/components/workflow/board/SystemWorkflowBoard.vue";
import type { TaskDetail, WorkflowDefinition, WorkflowGraph, WorkflowMeta, WorkflowTaskRecord, WorkflowTaskStatus } from "src/components/workflow/types";
import { getNodeDefinition } from "src/shared/nodes";
import { openWorkflowEditor, openTaskInMain } from "src/tauri-compat/core";
import { open as openDialog } from "src/tauri-compat/dialog";
import { listen, type UnlistenFn } from "src/tauri-compat/event";

const $q = useQuasar();
const isMac = $q.platform.is.mac;

const activeTab = ref<"workflows" | "tasks" | "settings">("workflows");
const activeTabLabel = computed(() => {
  if (activeTab.value === "workflows") return "工作流管理";
  if (activeTab.value === "tasks") return "任务管理";
  return "系统设置";
});

const workflows = ref<WorkflowMeta[]>([]);
const selectedWorkflowId = ref("");
const selectedWorkflowDef = ref<WorkflowDefinition | null>(null);
const workflowDraftGraph = ref<WorkflowGraph>({ nodes: [], edges: [] });
const workflowDraftDirty = ref(false);
const workflowRunSource = ref<"saved" | "draft">("saved");
const workflowErrorMsg = ref("");
const workflowBaselineHash = ref("");

const selectedWorkflow = computed(() => workflows.value.find((item) => item.id === selectedWorkflowId.value) || null);

function cloneGraph(graph: WorkflowGraph): WorkflowGraph {
  return JSON.parse(JSON.stringify(graph)) as WorkflowGraph;
}

function hashGraph(graph: WorkflowGraph): string {
  return JSON.stringify(graph);
}

function canonicalizeGraphForCompare(graph: WorkflowGraph, preserveNodeId: boolean): WorkflowGraph {
  const rawNodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const rawEdges = Array.isArray(graph.edges) ? graph.edges : [];

  if (preserveNodeId) {
    const nodes = rawNodes.map((node, idx) => {
      const nodeType = typeof node.type === "string" && node.type.trim() ? node.type.trim() : "custom";
      const nodeId = typeof node.id === "string" && node.id.trim() ? node.id.trim() : `node_${String(idx + 1)}`;
      return {
        ...node,
        id: nodeId,
        type: nodeType,
      };
    });
    const nodeIdSet = new Set(nodes.map((node) => node.id));
    const edges = rawEdges
      .map((edge, idx) => {
        if (!nodeIdSet.has(edge.source) || !nodeIdSet.has(edge.target)) {
          return null;
        }
        return {
          ...edge,
          id: edge.id || `edge_${String(idx + 1)}`,
        };
      })
      .filter((edge): edge is WorkflowGraph["edges"][number] => edge !== null);

    return { nodes, edges };
  }

  const idMap = new Map<string, string>();
  const typeCount = new Map<string, number>();
  const nodes = rawNodes.map((node, idx) => {
    const nodeType = typeof node.type === "string" && node.type.trim() ? node.type.trim() : "custom";
    const prefix = nodeType.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "node";
    const nextIndex = (typeCount.get(prefix) || 0) + 1;
    typeCount.set(prefix, nextIndex);
    const oldId = typeof node.id === "string" && node.id.trim() ? node.id.trim() : `node_${String(idx + 1)}`;
    const newId = `${prefix}_${String(nextIndex)}`;
    idMap.set(oldId, newId);
    return {
      ...node,
      id: newId,
      type: nodeType,
    };
  });

  const nodeIdSet = new Set(nodes.map((node) => node.id));
  const edges = rawEdges
    .map((edge, idx) => {
      const source = idMap.get(edge.source);
      const target = idMap.get(edge.target);
      if (!source || !target || !nodeIdSet.has(source) || !nodeIdSet.has(target)) {
        return null;
      }
      return {
        ...edge,
        id: edge.id || `edge_${String(idx + 1)}`,
        source,
        target,
      };
    })
    .filter((edge): edge is WorkflowGraph["edges"][number] => edge !== null);

  return { nodes, edges };
}

function recomputeWorkflowDraftDirty() {
  const preserveNodeId = selectedWorkflow.value?.source === "system";
  const draftHash = hashGraph(canonicalizeGraphForCompare(workflowDraftGraph.value, preserveNodeId));
  workflowDraftDirty.value = draftHash !== workflowBaselineHash.value;
  workflowRunSource.value = workflowDraftDirty.value ? "draft" : "saved";
}

function onWorkflowDraftDirtyChange(_dirty: boolean) {
  recomputeWorkflowDraftDirty();
}

async function loadSelectedWorkflowDefinition() {
  if (!selectedWorkflowId.value) {
    selectedWorkflowDef.value = null;
    workflowDraftGraph.value = { nodes: [], edges: [] };
    workflowDraftDirty.value = false;
    workflowRunSource.value = "saved";
    return;
  }
  const detail = await getWorkflow(selectedWorkflowId.value);
  selectedWorkflowDef.value = detail;
  workflowDraftGraph.value = cloneGraph(detail.graph);
  workflowBaselineHash.value = hashGraph(canonicalizeGraphForCompare(detail.graph, detail.source === "system"));
  workflowDraftDirty.value = false;
  workflowRunSource.value = "saved";
}

async function loadWorkflows() {
  workflowErrorMsg.value = "";
  try {
    workflows.value = await listWorkflows();
    if (workflows.value.length === 0) {
      selectedWorkflowId.value = "";
      await loadSelectedWorkflowDefinition();
      return;
    }

    const exists = workflows.value.some((item) => item.id === selectedWorkflowId.value);
    if (!exists) {
      selectedWorkflowId.value = workflows.value[0]?.id || "";
    }
    await loadSelectedWorkflowDefinition();
  } catch (error) {
    workflowErrorMsg.value = String(error);
  }
}

async function attemptSelectWorkflow(workflowId: string) {
  if (!workflowId || workflowId === selectedWorkflowId.value) {
    return;
  }

  if (selectedWorkflow.value?.source === "user" && workflowDraftDirty.value) {
    const confirmed = window.confirm("当前自定义工作流草稿未保存，切换后会丢失改动，是否继续？");
    if (!confirmed) {
      return;
    }
  }

  selectedWorkflowId.value = workflowId;
  await loadSelectedWorkflowDefinition();
}

async function openEditor(workflowId?: string) {
  workflowErrorMsg.value = "";
  try {
    await openWorkflowEditor(workflowId);
  } catch (error) {
    workflowErrorMsg.value = String(error);
  }
}

async function runSelectedWorkflow() {
  if (!selectedWorkflowId.value) {
    return;
  }
  workflowErrorMsg.value = "";
  try {
    const graphToRun = workflowDraftGraph.value;
    const runTask = await runWorkflowApi({
      id: selectedWorkflowId.value,
      runtimeInput: {},
      graph: graphToRun,
    });
    await openTaskInMain(runTask.id);
    workflowRunSource.value = workflowDraftDirty.value ? "draft" : "saved";
    activeTab.value = "tasks";
    await loadTasks();
    await selectTask(runTask.id);
  } catch (error) {
    workflowErrorMsg.value = String(error);
  }
}

async function duplicateSelectedWorkflow() {
  if (!selectedWorkflowId.value) {
    return;
  }
  workflowErrorMsg.value = "";
  try {
    const duplicated = await duplicateWorkflowApi(selectedWorkflowId.value);
    await loadWorkflows();
    selectedWorkflowId.value = duplicated.id;
    await loadSelectedWorkflowDefinition();
  } catch (error) {
    workflowErrorMsg.value = String(error);
  }
}

async function removeSelectedWorkflow() {
  if (!selectedWorkflow.value || selectedWorkflow.value.source !== "user") {
    return;
  }
  const confirmed = window.confirm(`确认删除自定义工作流“${selectedWorkflow.value.name}”？`);
  if (!confirmed) {
    return;
  }
  workflowErrorMsg.value = "";
  try {
    await deleteWorkflow(selectedWorkflow.value.id);
    await loadWorkflows();
  } catch (error) {
    workflowErrorMsg.value = String(error);
  }
}

async function restoreAllSystemWorkflows() {
  const confirmed = window.confirm("将还原全部内置工作流为默认内容，是否继续？");
  if (!confirmed) {
    return;
  }
  workflowErrorMsg.value = "";
  try {
    await restoreAllWorkflowDefaults();
    await loadWorkflows();
  } catch (error) {
    workflowErrorMsg.value = String(error);
  }
}

async function restoreSelectedWorkflow() {
  if (!selectedWorkflow.value || selectedWorkflow.value.source !== "system") {
    return;
  }

  const confirmed = window.confirm("将还原当前内置工作流为默认内容，是否继续？");
  if (!confirmed) {
    return;
  }

  workflowErrorMsg.value = "";
  try {
    await restoreWorkflowDefault(selectedWorkflow.value.id);
    await loadWorkflows();
  } catch (error) {
    workflowErrorMsg.value = String(error);
  }
}

function patchDraftNodeConfig(nodeId: string, key: string, value: unknown) {
  workflowDraftGraph.value = {
    ...workflowDraftGraph.value,
    nodes: workflowDraftGraph.value.nodes.map((node) => {
      if (node.id !== nodeId) {
        return node;
      }
      const currentConfig = node.config && typeof node.config === "object" && !Array.isArray(node.config)
        ? (node.config as Record<string, unknown>)
        : {};
      const nextConfig: Record<string, unknown> = {
        ...currentConfig,
      };
      const shouldDelete = value === undefined || value === null || (typeof value === "string" && !value.trim());
      if (shouldDelete) {
        delete nextConfig[key];
      } else {
        nextConfig[key] = value;
      }
      return {
        ...node,
        config: nextConfig,
      };
    }),
  };
  recomputeWorkflowDraftDirty();
}

function handleWorkflowBoardUpdate(payload: { nodeId: string; key: string; value: unknown }) {
  patchDraftNodeConfig(payload.nodeId, payload.key, payload.value);
}

async function handleWorkflowBoardPickPath(payload: { nodeId: string; key: string; directory: boolean }) {
  try {
    const selected = await openDialog({
      directory: payload.directory,
      multiple: false,
      title: payload.directory ? "选择目录" : "选择文件",
      filters: payload.directory
        ? undefined
        : [
            {
              name: "视频文件",
              extensions: ["mp4"],
            },
          ],
    });
    if (typeof selected !== "string" || !selected.trim()) {
      return;
    }
    patchDraftNodeConfig(payload.nodeId, payload.key, selected);
  } catch (error) {
    workflowErrorMsg.value = `选择路径失败: ${String(error)}`;
  }
}

type NodeRunState = "done" | "running" | "waiting" | "failed" | "canceled" | "idle";

const tasks = ref<WorkflowTaskRecord[]>([]);
const selectedTaskId = ref("");
const taskDetail = ref<TaskDetail | null>(null);
const taskFilter = ref<"all" | WorkflowTaskStatus>("all");
const interactionForm = ref<Record<string, unknown>>({});
const taskErrorMsg = ref("");
const removingTaskIds = ref<string[]>([]);
const selectedLogNodeId = ref("");
const unlisteners: UnlistenFn[] = [];
let pollTimer: ReturnType<typeof setInterval> | null = null;

const taskEdgeOptions = {
  type: "default",
  style: {
    stroke: "#4f9f95",
    strokeWidth: 2,
  },
};

const taskFilterOptions = [
  { label: "全部", value: "all" },
  { label: "运行中", value: "running" },
  { label: "待人工", value: "waiting_input" },
  { label: "失败", value: "failed" },
  { label: "完成", value: "completed" },
];

const filteredTasks = computed(() => {
  if (taskFilter.value === "all") {
    return tasks.value;
  }
  return tasks.value.filter((item) => item.status === taskFilter.value);
});

const waitingCount = computed(() => tasks.value.filter((item) => item.status === "waiting_input").length);
const taskNodeMap = computed(() => {
  const map = new Map<string, string>();
  for (const node of taskDetail.value?.workflowGraph?.nodes || []) {
    map.set(node.id, node.remark || getNodeDefinition(node.type)?.name || node.id);
  }
  return map;
});
const graphTotalCount = computed(() => taskDetail.value?.workflowGraph?.nodes.length || 0);
const graphDoneCount = computed(() => {
  if (!taskDetail.value) {
    return 0;
  }
  if (taskDetail.value.task.status === "completed") {
    return graphTotalCount.value;
  }
  const executedSet = new Set(taskDetail.value.graphProgress?.executedNodeIds || []);
  return (taskDetail.value.workflowGraph?.nodes || []).reduce((count, node) => {
    return count + (executedSet.has(node.id) ? 1 : 0);
  }, 0);
});
const graphPercent = computed(() => {
  if (graphTotalCount.value <= 0) {
    return 0;
  }
  return Math.min(100, Math.round((graphDoneCount.value / graphTotalCount.value) * 100));
});
const graphPhaseText = computed(() => formatPhase(taskDetail.value?.graphProgress?.phase || ""));
const currentNodeText = computed(() => {
  const currentId = taskDetail.value?.task.currentNodeId || "";
  if (!currentId) {
    return "-";
  }
  const label = taskNodeMap.value.get(currentId);
  return label ? `${label} (${currentId})` : currentId;
});
const selectedLogNodeText = computed(() => {
  if (!selectedLogNodeId.value) {
    return "全部日志";
  }
  return taskNodeMap.value.get(selectedLogNodeId.value) || selectedLogNodeId.value;
});
const filteredTaskLogs = computed(() => {
  const detail = taskDetail.value;
  if (!detail) {
    return [];
  }
  if (!selectedLogNodeId.value) {
    return detail.logs;
  }
  return detail.logs.filter((log) => log.nodeId === selectedLogNodeId.value);
});

const taskGraphNodes = computed<Array<Node>>(() => {
  const graph = taskDetail.value?.workflowGraph;
  if (!graph) {
    return [];
  }
  return graph.nodes.map((node, idx) => {
    const state = resolveNodeRunState(node.id);
    const fallbackX = 80 + (idx % 3) * 320;
    const fallbackY = 90 + Math.floor(idx / 3) * 180;
    const x = Number.isFinite(node.position?.x) ? Number(node.position?.x) : fallbackX;
    const y = Number.isFinite(node.position?.y) ? Number(node.position?.y) : fallbackY;
    return {
      id: node.id,
      position: { x, y },
      data: {
        label: `${stateIcon(state)} ${node.remark || getNodeDefinition(node.type)?.name || node.id}`,
      },
      style: resolveNodeStyle(node.id, state),
      draggable: false,
      selectable: false,
      connectable: false,
    };
  });
});

const taskGraphEdges = computed<Edge[]>(() => {
  const graph = taskDetail.value?.workflowGraph;
  if (!graph) {
    return [];
  }
  const doneSet = new Set(taskDetail.value?.graphProgress?.executedNodeIds || []);
  return graph.edges.map((edge) => {
    const active = doneSet.has(edge.source) || doneSet.has(edge.target) || edge.target === taskDetail.value?.task.currentNodeId;
    return {
      id: edge.id,
      type: "default",
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      style: {
        stroke: active ? "#14a79a" : "#7ea8a4",
        strokeWidth: active ? 2.4 : 2,
      },
      animated: active && taskDetail.value?.task.status === "running",
    };
  });
});

function statusColor(status: WorkflowTaskStatus): string {
  switch (status) {
    case "queued":
      return "grey";
    case "running":
      return "primary";
    case "waiting_input":
      return "deep-orange";
    case "completed":
      return "positive";
    case "failed":
      return "negative";
    case "canceled":
      return "dark";
    default:
      return "grey";
  }
}

function cannotCancel(status: WorkflowTaskStatus): boolean {
  return status === "completed" || status === "failed" || status === "canceled";
}

function formatPhase(phase: string): string {
  switch (phase) {
    case "graph_running":
      return "执行中";
    case "graph_waiting":
      return "等待人工输入";
    case "graph_done":
    case "done":
      return "执行完成";
    case "await_single_segments":
      return "等待单视频分段";
    case "await_batch_segments":
      return "等待批量分段";
    default:
      return phase || "准备中";
  }
}

function resolveNodeRunState(nodeId: string): NodeRunState {
  if (!taskDetail.value) {
    return "idle";
  }
  const task = taskDetail.value.task;
  const pendingNodeId = taskDetail.value.graphProgress?.pendingNodeId || "";
  const executed = new Set(taskDetail.value.graphProgress?.executedNodeIds || []);

  if (task.status === "completed") {
    return "done";
  }
  if (task.status === "failed" && task.currentNodeId === nodeId) {
    return "failed";
  }
  if (task.status === "canceled" && task.currentNodeId === nodeId) {
    return "canceled";
  }
  if (
    pendingNodeId === nodeId ||
    (task.status === "waiting_input" && (task.currentNodeId === nodeId || task.waitingInteraction?.nodeId === nodeId))
  ) {
    return "waiting";
  }
  if (executed.has(nodeId)) {
    return "done";
  }
  if (task.status === "running" && task.currentNodeId === nodeId) {
    return "running";
  }
  return "idle";
}

function stateIcon(state: NodeRunState): string {
  switch (state) {
    case "done":
      return "✓";
    case "running":
      return "▶";
    case "waiting":
      return "⌛";
    case "failed":
      return "✕";
    case "canceled":
      return "■";
    default:
      return "○";
  }
}

function baseNodeStyleByState(state: NodeRunState): Record<string, string> {
  if (state === "done") {
    return {
      border: "1px solid #14b8a6",
      borderRadius: "10px",
      background: "rgba(20,184,166,0.14)",
      color: "#0f766e",
      fontSize: "12px",
      minWidth: "180px",
      boxShadow: "0 0 0 1px rgba(20,184,166,0.2)",
    };
  }
  if (state === "running") {
    return {
      border: "1px solid #0891b2",
      borderRadius: "10px",
      background: "rgba(8,145,178,0.14)",
      color: "#155e75",
      fontSize: "12px",
      minWidth: "180px",
      boxShadow: "0 0 0 1px rgba(8,145,178,0.2)",
    };
  }
  if (state === "waiting") {
    return {
      border: "1px solid #f59e0b",
      borderRadius: "10px",
      background: "rgba(245,158,11,0.14)",
      color: "#92400e",
      fontSize: "12px",
      minWidth: "180px",
      boxShadow: "0 0 0 1px rgba(245,158,11,0.2)",
    };
  }
  if (state === "failed") {
    return {
      border: "1px solid #ef4444",
      borderRadius: "10px",
      background: "rgba(239,68,68,0.14)",
      color: "#991b1b",
      fontSize: "12px",
      minWidth: "180px",
      boxShadow: "0 0 0 1px rgba(239,68,68,0.2)",
    };
  }
  if (state === "canceled") {
    return {
      border: "1px solid #7c8d8a",
      borderRadius: "10px",
      background: "rgba(124,141,138,0.15)",
      color: "#425a57",
      fontSize: "12px",
      minWidth: "180px",
    };
  }
  return {
    border: "1px solid #93b6b1",
    borderRadius: "10px",
    background: "#f4fffd",
    color: "#325f5a",
    fontSize: "12px",
    minWidth: "180px",
  };
}

function resolveNodeStyle(nodeId: string, state: NodeRunState): Record<string, string> {
  const base = baseNodeStyleByState(state);
  if (selectedLogNodeId.value && selectedLogNodeId.value === nodeId) {
    return {
      ...base,
      boxShadow: "0 0 0 2px rgba(251,191,36,0.7)",
    };
  }
  return base;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return date.toLocaleString();
}

function addRemovingTaskId(taskId: string): void {
  if (!removingTaskIds.value.includes(taskId)) {
    removingTaskIds.value = [...removingTaskIds.value, taskId];
  }
}

function removeRemovingTaskId(taskId: string): void {
  removingTaskIds.value = removingTaskIds.value.filter((item) => item !== taskId);
}

async function loadTasks() {
  tasks.value = await listTasks();

  if (selectedTaskId.value) {
    const existing = tasks.value.find((item) => item.id === selectedTaskId.value);
    if (!existing) {
      selectedTaskId.value = "";
      taskDetail.value = null;
    }
  }
}

function fillInteractionForm() {
  const interaction = taskDetail.value?.interactionRequest;
  if (!interaction) {
    interactionForm.value = {};
    return;
  }

  const next: Record<string, unknown> = {};
  for (const field of interaction.formSchema) {
    next[field.id] = field.defaultValue ?? (field.type === "boolean" ? false : "");
  }
  interactionForm.value = next;
}

async function selectTask(taskId: string) {
  const switchedTask = selectedTaskId.value !== taskId;
  selectedTaskId.value = taskId;
  if (switchedTask) {
    selectedLogNodeId.value = "";
  }
  taskErrorMsg.value = "";
  try {
    taskDetail.value = await getTask(taskId);
    fillInteractionForm();
  } catch (error) {
    taskDetail.value = null;
    selectedTaskId.value = "";
    await loadTasks();
    taskErrorMsg.value = String(error);
  }
}

function onProgressNodeClick(event: { node: Node }) {
  selectedLogNodeId.value = event.node.id;
}

function clearLogFilter() {
  selectedLogNodeId.value = "";
}

async function resumeTask() {
  if (!selectedTaskId.value) return;
  taskErrorMsg.value = "";
  try {
    await resumeTaskApi(selectedTaskId.value, interactionForm.value);
    await loadTasks();
    await selectTask(selectedTaskId.value);
  } catch (error) {
    taskErrorMsg.value = String(error);
  }
}

async function cancelTask() {
  if (!selectedTaskId.value) return;
  taskErrorMsg.value = "";
  try {
    await cancelTaskApi(selectedTaskId.value);
    await loadTasks();
    await selectTask(selectedTaskId.value);
  } catch (error) {
    taskErrorMsg.value = String(error);
  }
}

async function removeSingleTask(taskId: string) {
  const task = tasks.value.find((item) => item.id === taskId);
  if (!task) {
    return;
  }

  const isRunning = task.status === "queued" || task.status === "running" || task.status === "waiting_input";
  const confirmed = window.confirm(
    isRunning
      ? "该任务正在进行中，移除后将从任务列表消失，是否继续？"
      : "确认移除该任务？",
  );
  if (!confirmed) {
    return;
  }

  taskErrorMsg.value = "";
  addRemovingTaskId(taskId);
  try {
    await removeTaskApi(taskId);
    if (selectedTaskId.value === taskId) {
      selectedTaskId.value = "";
      taskDetail.value = null;
    }
    await loadTasks();
  } catch (error) {
    taskErrorMsg.value = String(error);
  } finally {
    removeRemovingTaskId(taskId);
  }
}

async function handleTaskUpdate(payload: unknown) {
  const record = payload as WorkflowTaskRecord;
  if (!record || !record.id) return;
  try {
    await loadTasks();
    if (selectedTaskId.value === record.id) {
      await selectTask(record.id);
    }
  } catch (error) {
    console.warn("刷新任务状态失败:", error);
  }
}

async function handleTaskLog(payload: unknown) {
  const data = payload as { taskId?: string };
  if (!data?.taskId || data.taskId !== selectedTaskId.value) {
    return;
  }
  try {
    await selectTask(data.taskId);
  } catch (error) {
    console.warn("刷新任务日志失败:", error);
  }
}

async function handleTaskProgress(payload: unknown) {
  const data = payload as { taskId?: string };
  if (!data?.taskId || data.taskId !== selectedTaskId.value) {
    return;
  }
  try {
    await selectTask(data.taskId);
  } catch (error) {
    console.warn("刷新任务进度失败:", error);
  }
}

async function handleTaskRemoved(payload: unknown) {
  const data = payload as { taskId?: string };
  if (!data?.taskId) {
    return;
  }
  if (selectedTaskId.value === data.taskId) {
    selectedTaskId.value = "";
    taskDetail.value = null;
  }
  try {
    await loadTasks();
  } catch (error) {
    console.warn("刷新任务列表失败:", error);
  }
}

const settingCatalog = ref<"directory">("directory");

onMounted(async () => {
  await loadWorkflows();
  await subscribeTasks();
  await loadTasks();

  unlisteners.push(await listen("task:update", (event) => {
    void handleTaskUpdate(event.payload);
  }));

  unlisteners.push(await listen("task:log", (event) => {
    void handleTaskLog(event.payload);
  }));

  unlisteners.push(await listen("task:progress", (event) => {
    void handleTaskProgress(event.payload);
  }));

  unlisteners.push(await listen("task:removed", (event) => {
    void handleTaskRemoved(event.payload);
  }));

  unlisteners.push(await listen<{ taskId?: string }>("ui:open-task", (event) => {
    const taskId = typeof event.payload?.taskId === "string" ? event.payload.taskId : "";
    activeTab.value = "tasks";
    if (taskId) {
      void selectTask(taskId);
    }
  }));

  unlisteners.push(await listen("ui:workflow-list-refresh", () => {
    void loadWorkflows();
  }));

  pollTimer = setInterval(() => {
    void loadTasks();
  }, 3000);
});

onUnmounted(() => {
  for (const unlisten of unlisteners) {
    unlisten();
  }
  if (pollTimer) {
    clearInterval(pollTimer);
  }
});
</script>

<style scoped>
.titlebar-brand {
  display: inline-flex;
  align-items: center;
  color: #0d4f4b;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.2px;
}

.left-nav {
  padding: 2px 0;
}

.nav-btn {
  width: 46px;
  height: 46px;
  color: #0a4a45;
  background: rgba(21, 170, 152, 0.12);
}

.nav-btn-active {
  color: #fff;
  background: linear-gradient(140deg, #17a79a, #ff7c5c);
  box-shadow: 0 10px 24px rgba(23, 167, 154, 0.3);
}

.middle-pane {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.pane-block {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.pane-header {
  padding: 12px 12px 10px;
  border-bottom: 1px solid rgba(9, 91, 85, 0.1);
  background: rgba(255, 255, 255, 0.65);
}

.pane-title {
  font-weight: 700;
  color: #0a4a45;
}

.pane-scroll {
  flex: 1;
}

.workflow-item,
.task-item,
.setting-item {
  border-radius: 12px;
  margin-bottom: 8px;
}

.workflow-item-active,
.task-item-active,
.setting-item-active {
  background: rgba(21, 170, 152, 0.18);
  color: #0d4f4b;
}

.right-pane {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 12px;
}

.right-header {
  padding: 8px 10px;
  border-radius: 14px;
  border: 1px solid rgba(10, 74, 69, 0.1);
  background: rgba(255, 255, 255, 0.76);
}

.workflow-right-content {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.canvas-wrapper {
  height: calc(100vh - 144px);
}

.detail-card {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border-radius: 16px;
  border-color: rgba(9, 91, 85, 0.15);
  background: rgba(255, 255, 255, 0.8);
}

.inner-block {
  border-radius: 14px;
  border-color: rgba(9, 91, 85, 0.15);
  background: rgba(240, 255, 252, 0.82);
}

.task-log-area {
  border-radius: 10px;
  background: #f8fffd;
  border: 1px solid rgba(9, 91, 85, 0.12);
}

.task-graph-wrap {
  height: 340px;
  border-top: 1px solid rgba(9, 91, 85, 0.1);
}

.task-progress-flow {
  width: 100%;
  height: 100%;
  min-height: 340px;
}

.task-progress-flow :deep(.vue-flow__node) {
  cursor: pointer;
}

.empty-state {
  min-height: 280px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #4f7f7a;
}

@media (max-width: 920px) {
  .canvas-wrapper {
    height: 520px;
  }
}
</style>
