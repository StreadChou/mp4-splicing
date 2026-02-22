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
              <div>当前节点：{{ taskDetail.task.currentNodeId }}</div>
              <div>运行目录：{{ taskDetail.task.runDir }}</div>
              <div v-if="taskDetail.task.error" class="text-negative">错误：{{ taskDetail.task.error }}</div>
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
              <div class="text-subtitle1 text-weight-medium q-mb-sm">任务日志</div>
              <q-scroll-area style="height: 380px" class="task-log-area">
                <q-list dense>
                  <q-item v-for="(log, idx) in taskDetail.logs" :key="idx">
                    <q-item-section>
                      <q-item-label caption class="text-grey-5">
                        {{ formatDate(log.timestamp) }} [{{ log.level }}]
                      </q-item-label>
                      <q-item-label class="text-grey-3">{{ log.message }}</q-item-label>
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
const unlisteners: UnlistenFn[] = [];
let pollTimer: ReturnType<typeof setInterval> | null = null;

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
  selectedTaskId.value = taskId;
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

.empty-state {
  min-height: 280px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #94a3b8;
}
</style>
