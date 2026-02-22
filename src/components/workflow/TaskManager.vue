<template>
  <div class="task-manager row q-col-gutter-md">
    <div class="col-12 col-lg-4">
      <q-card flat bordered class="module-card full-height">
        <q-card-section class="row items-center q-gutter-sm">
          <div class="text-h6 text-weight-medium">任务管理</div>
          <q-space />
          <q-btn flat round dense icon="refresh" color="grey-4" @click="loadTasks">
            <q-tooltip>刷新任务列表</q-tooltip>
          </q-btn>
          <q-btn
            dense
            unelevated
            icon="playlist_remove"
            label="一键删除已完成"
            color="negative"
            :disable="completedCount === 0 || clearCompletedBusy"
            :loading="clearCompletedBusy"
            @click="clearCompleted"
          />
        </q-card-section>

        <q-card-section class="q-pt-none">
          <q-btn-toggle
            v-model="filter"
            spread
            dense
            unelevated
            toggle-color="primary"
            color="grey-9"
            text-color="grey-4"
            :options="filterOptions"
            class="task-filter"
          />
        </q-card-section>

        <q-separator dark />

        <q-list separator class="task-list">
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
              <q-item-label caption class="text-grey-5">{{ formatDate(task.createdAt) }}</q-item-label>
            </q-item-section>

            <q-item-section side>
              <div class="row items-center q-gutter-xs">
                <q-chip dense :color="statusColor(task.status)" text-color="white">{{ task.status }}</q-chip>
                <q-btn
                  flat
                  round
                  dense
                  icon="delete"
                  color="negative"
                  :loading="removingTaskIds.includes(task.id)"
                  @click.stop="removeSingleTask(task.id)"
                >
                  <q-tooltip>移除任务</q-tooltip>
                </q-btn>
              </div>
            </q-item-section>
          </q-item>

          <div v-if="filteredTasks.length === 0" class="text-grey-6 text-caption q-pa-md">
            当前筛选条件下没有任务
          </div>
        </q-list>
      </q-card>
    </div>

    <div class="col-12 col-lg-8">
      <q-card flat bordered class="module-card full-height">
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

            <q-separator dark />

            <q-card-section class="q-gutter-sm text-caption text-grey-4">
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
              <q-chip dense color="grey-8" text-color="grey-2">{{ graphPhaseText }}</q-chip>
            </q-card-section>

            <q-separator dark />

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
                  <Background pattern-color="#334155" :gap="20" />
                </VueFlow>
              </div>
            </q-card-section>
            <q-card-section v-else class="text-caption text-grey-5">
              当前任务暂无流程图快照
            </q-card-section>
            <q-card-section class="text-caption text-grey-5 q-pt-sm">
              点击流程节点可只看该节点日志，点击空白区域恢复“全部日志”。
            </q-card-section>
          </q-card>

          <q-card v-if="taskDetail.interactionRequest" flat bordered class="inner-block">
            <q-card-section class="q-gutter-sm">
              <div class="text-subtitle1 text-warning">
                <q-icon name="notification_important" class="q-mr-xs" />
                待人工处理：{{ taskDetail.interactionRequest.title }}
              </div>
              <div class="text-caption text-grey-5">{{ taskDetail.interactionRequest.description }}</div>

              <div v-for="field in taskDetail.interactionRequest.formSchema" :key="field.id" class="q-mt-sm">
                <q-input
                  v-if="field.type === 'text' || field.type === 'json'"
                  v-model="interactionForm[field.id]"
                  :label="field.label"
                  outlined
                  dark
                  :placeholder="field.placeholder"
                />

                <q-input
                  v-else-if="field.type === 'textarea'"
                  v-model="interactionForm[field.id]"
                  type="textarea"
                  autogrow
                  :label="field.label"
                  outlined
                  dark
                  :placeholder="field.placeholder"
                />

                <q-input
                  v-else-if="field.type === 'number'"
                  v-model.number="interactionForm[field.id]"
                  type="number"
                  :label="field.label"
                  outlined
                  dark
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
                  dark
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
                  :color="selectedLogNodeId ? 'grey-8' : 'primary'"
                  text-color="white"
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
              <q-scroll-area style="height: 380px" class="task-log-area">
                <q-list dense>
                  <q-item v-for="(log, idx) in filteredTaskLogs" :key="idx">
                    <q-item-section>
                      <q-item-label caption class="text-grey-5">
                        {{ formatDate(log.timestamp) }} [{{ log.level }}]
                        <span v-if="log.nodeLabel" class="text-amber-4"> · {{ log.nodeLabel }}</span>
                      </q-item-label>
                      <q-item-label class="text-grey-3">{{ log.message }}</q-item-label>
                    </q-item-section>
                  </q-item>
                  <q-item v-if="filteredTaskLogs.length === 0">
                    <q-item-section>
                      <q-item-label class="text-grey-5">
                        当前筛选条件下暂无日志
                      </q-item-label>
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

        <q-banner v-if="errorMsg" rounded dense class="bg-negative text-white q-ma-md">
          {{ errorMsg }}
        </q-banner>
      </q-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { Background } from "@vue-flow/background";
import { ConnectionLineType, type Edge, type Node, VueFlow } from "@vue-flow/core";
import {
  cancelTask as cancelTaskApi,
  clearCompletedTasks,
  getTask,
  listTasks,
  removeTask as removeTaskApi,
  resumeTask as resumeTaskApi,
  subscribeTasks,
} from "src/api/task-api";
import { listen, type UnlistenFn } from "src/tauri-compat/event";
import type { TaskDetail, WorkflowTaskRecord, WorkflowTaskStatus } from "./types";

type NodeRunState = "done" | "running" | "waiting" | "failed" | "canceled" | "idle";

const emit = defineEmits<{
  "waiting-count": [count: number];
}>();

const tasks = ref<WorkflowTaskRecord[]>([]);
const selectedTaskId = ref("");
const taskDetail = ref<TaskDetail | null>(null);
const filter = ref<"all" | WorkflowTaskStatus>("all");
const interactionForm = ref<Record<string, unknown>>({});
const errorMsg = ref("");
const clearCompletedBusy = ref(false);
const removingTaskIds = ref<string[]>([]);
const selectedLogNodeId = ref("");
const unlisteners: UnlistenFn[] = [];
let pollTimer: ReturnType<typeof setInterval> | null = null;
const taskEdgeOptions = {
  type: "default",
  style: {
    stroke: "#64748b",
    strokeWidth: 2,
  },
};

const filterOptions = [
  { label: "全部", value: "all" },
  { label: "运行中", value: "running" },
  { label: "待人工", value: "waiting_input" },
  { label: "失败", value: "failed" },
  { label: "完成", value: "completed" },
];

const filteredTasks = computed(() => {
  if (filter.value === "all") {
    return tasks.value;
  }
  return tasks.value.filter((item) => item.status === filter.value);
});

const completedCount = computed(() => tasks.value.filter((item) => item.status === "completed").length);
const taskNodeMap = computed(() => {
  const map = new Map<string, string>();
  for (const node of taskDetail.value?.workflowGraph?.nodes || []) {
    map.set(node.id, node.label || node.id);
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
        label: `${stateIcon(state)} ${node.label || node.id}`,
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
        stroke: active ? "#22c55e" : "#64748b",
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
      border: "1px solid #22c55e",
      borderRadius: "10px",
      background: "rgba(34,197,94,0.18)",
      color: "#dcfce7",
      fontSize: "12px",
      minWidth: "180px",
      boxShadow: "0 0 0 1px rgba(34,197,94,0.25)",
    };
  }
  if (state === "running") {
    return {
      border: "1px solid #38bdf8",
      borderRadius: "10px",
      background: "rgba(14,165,233,0.2)",
      color: "#e0f2fe",
      fontSize: "12px",
      minWidth: "180px",
      boxShadow: "0 0 0 1px rgba(56,189,248,0.25)",
    };
  }
  if (state === "waiting") {
    return {
      border: "1px solid #f59e0b",
      borderRadius: "10px",
      background: "rgba(245,158,11,0.2)",
      color: "#fef3c7",
      fontSize: "12px",
      minWidth: "180px",
      boxShadow: "0 0 0 1px rgba(245,158,11,0.28)",
    };
  }
  if (state === "failed") {
    return {
      border: "1px solid #ef4444",
      borderRadius: "10px",
      background: "rgba(239,68,68,0.18)",
      color: "#fee2e2",
      fontSize: "12px",
      minWidth: "180px",
      boxShadow: "0 0 0 1px rgba(239,68,68,0.25)",
    };
  }
  if (state === "canceled") {
    return {
      border: "1px solid #a3a3a3",
      borderRadius: "10px",
      background: "rgba(115,115,115,0.18)",
      color: "#f5f5f5",
      fontSize: "12px",
      minWidth: "180px",
    };
  }
  return {
    border: "1px solid #334155",
    borderRadius: "10px",
    background: "#0f172a",
    color: "#cbd5e1",
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
  emit("waiting-count", tasks.value.filter((item) => item.status === "waiting_input").length);

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
  errorMsg.value = "";
  try {
    taskDetail.value = await getTask(taskId);
    fillInteractionForm();
  } catch (error) {
    taskDetail.value = null;
    selectedTaskId.value = "";
    await loadTasks();
    errorMsg.value = String(error);
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
  errorMsg.value = "";
  try {
    await resumeTaskApi(selectedTaskId.value, interactionForm.value);
    await loadTasks();
    await selectTask(selectedTaskId.value);
  } catch (error) {
    errorMsg.value = String(error);
  }
}

async function cancelTask() {
  if (!selectedTaskId.value) return;
  errorMsg.value = "";
  try {
    await cancelTaskApi(selectedTaskId.value);
    await loadTasks();
    await selectTask(selectedTaskId.value);
  } catch (error) {
    errorMsg.value = String(error);
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

  errorMsg.value = "";
  addRemovingTaskId(taskId);
  try {
    await removeTaskApi(taskId);
    if (selectedTaskId.value === taskId) {
      selectedTaskId.value = "";
      taskDetail.value = null;
    }
    await loadTasks();
  } catch (error) {
    errorMsg.value = String(error);
  } finally {
    removeRemovingTaskId(taskId);
  }
}

async function clearCompleted() {
  if (completedCount.value === 0) {
    return;
  }
  if (!window.confirm(`确认删除 ${String(completedCount.value)} 个已完成任务？`)) {
    return;
  }

  errorMsg.value = "";
  clearCompletedBusy.value = true;
  try {
    const result = await clearCompletedTasks();
    if (result.ids.includes(selectedTaskId.value)) {
      selectedTaskId.value = "";
      taskDetail.value = null;
    }
    await loadTasks();
  } catch (error) {
    errorMsg.value = String(error);
  } finally {
    clearCompletedBusy.value = false;
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

defineExpose({
  selectTask,
  refreshTasks: loadTasks,
});

onMounted(async () => {
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
.task-manager {
  min-height: calc(100vh - 120px);
}

.module-card {
  background: #111827;
  border-color: #243043;
  color: #e5e7eb;
}

.inner-block {
  background: #0f172a;
  border-color: #243043;
  color: #e5e7eb;
}

.task-list {
  max-height: calc(100vh - 270px);
  overflow: auto;
}

.task-item {
  margin: 6px 10px;
  border-radius: 10px;
  background: #0f172a;
}

.task-item-active {
  background: #1e293b;
  color: #f8fafc;
}

.task-filter :deep(.q-btn) {
  border-radius: 8px;
}

.task-log-area {
  border-radius: 10px;
  background: #0b1220;
  border: 1px solid #243043;
}

.task-graph-wrap {
  height: 360px;
  border-top: 1px solid #243043;
}

.task-progress-flow {
  width: 100%;
  height: 100%;
  min-height: 360px;
}

.task-progress-flow :deep(.vue-flow__node) {
  cursor: pointer;
}

.empty-state {
  min-height: 280px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #94a3b8;
}
</style>
