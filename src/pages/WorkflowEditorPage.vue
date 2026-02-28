<template>
  <q-layout view="hHh lpR fFf" class="editor-layout">
    <q-header elevated class="bg-dark text-white">
      <q-toolbar>
        <q-btn flat dense round icon="arrow_back" @click="closeWindow">
          <q-tooltip>关闭窗口</q-tooltip>
        </q-btn>
        <q-toolbar-title>
          <div class="row items-center q-gutter-sm no-wrap">
            <q-icon name="account_tree" />
            <span>工作流编辑器</span>
            <q-badge v-if="isReadonly" color="blue">内置只读</q-badge>
            <q-badge v-else-if="isSystemWorkflow" color="amber-5" text-color="dark">内置流程(仅参数/位置)</q-badge>
          </div>
        </q-toolbar-title>
        <q-btn flat dense icon="refresh" @click="reloadWorkflow">
          <q-tooltip>刷新当前工作流</q-tooltip>
        </q-btn>
        <q-btn
          v-if="isSystemWorkflow"
          flat
          dense
          icon="restart_alt"
          label="还原默认"
          :disable="!currentWorkflowId"
          @click="restoreDefaultWorkflow"
        />
        <q-btn flat dense icon="content_copy" label="另存为" @click="saveAsCopy" />
        <q-btn color="positive" dense icon="play_arrow" label="运行" :disable="!currentWorkflowId" @click="handleRunWorkflow" />
        <q-btn
          color="primary"
          dense
          icon="save"
          label="保存"
          :disable="isReadonly"
          @click="saveWorkflow"
        />
      </q-toolbar>
    </q-header>
    <q-page-container>
      <q-page class="q-pa-md editor-page">
        <q-card flat bordered class="q-pa-md q-mb-sm metadata-card">
          <div class="row q-col-gutter-md">
            <div class="col-12 col-md-5">
              <q-input
                v-model="form.name"
                label="工作流名称"
                outlined
                :disable="isReadonly || isSystemWorkflow"
                hint="名称不可重复（忽略大小写和首尾空格）"
              />
            </div>
            <div class="col-12 col-md-7">
              <q-input
                v-model="form.description"
                label="描述"
                outlined
                autogrow
                :disable="isReadonly || isSystemWorkflow"
              />
            </div>
          </div>
          <q-banner v-if="errorMsg" class="bg-negative text-white q-mt-sm" rounded>
            {{ errorMsg }}
          </q-banner>
        </q-card>
        <q-card flat bordered class="metadata-card editor-content-card">
          <q-tabs
            v-model="editorTab"
            dense
            align="left"
            active-color="amber-4"
            indicator-color="amber-4"
            class="text-grey-3"
          >
            <q-tab name="visual" icon="account_tree" label="流程图" />
            <q-tab name="board" icon="view_week" label="表单看板" />
            <q-tab name="code" icon="code" label="代码视图" />
          </q-tabs>
          <q-separator dark />
          <q-tab-panels
            v-model="editorTab"
            animated
            keep-alive
            class="bg-transparent"
          >
            <q-tab-panel name="visual" class="q-pa-none">
              <WorkflowBlueprintEditor
                v-model="graphModel"
                :readonly="isReadonly"
                :structure-locked="isSystemWorkflow"
              />
            </q-tab-panel>
            <q-tab-panel name="board" class="q-pa-sm">
              <SystemWorkflowBoard
                v-if="isSystemWorkflow"
                :system-kind="currentWorkflowSystemKind"
                :graph="graphModel"
                :readonly="isReadonly"
                @update-field="handleBoardFieldUpdate"
                @pick-path="handleBoardPickPath"
              />
              <div v-else class="form-board">
                <q-banner dense rounded class="bg-grey-9 text-grey-4 q-mb-md">
                  表单看板仅展示配置卡片：必填项在上，可选项在中，有默认值项在下。
                </q-banner>
                <div v-for="section in boardSections" :key="section.key" class="q-mb-md">
                  <div class="board-section-title">{{ section.title }}</div>
                  <div class="board-card-grid">
                    <BoardNodeCard
                      v-for="card in section.cards"
                      :key="`${section.key}-${card.nodeId}`"
                      :card="card"
                      :readonly="isReadonly"
                      :config="readNodeConfig(card.nodeId)"
                      @update-field="handleBoardFieldUpdate"
                      @pick-path="handleBoardPickPath"
                    />
                    <q-card v-if="section.cards.length === 0" flat bordered class="board-empty-card">
                      <q-card-section class="text-caption text-grey-5">{{ section.emptyText }}</q-card-section>
                    </q-card>
                  </div>
                </div>
              </div>
            </q-tab-panel>
            <q-tab-panel name="code" class="q-pa-sm">
              <div class="row items-center q-gutter-sm q-mb-sm">
                <q-btn dense flat icon="sync" label="从流程图生成" @click="syncCodeFromCanvas" />
                <q-btn
                  dense
                  color="primary"
                  icon="published_with_changes"
                  label="应用到流程图"
                  :disable="isReadonly || isSystemWorkflow"
                  @click="applyCodeToCanvas"
                />
                <q-space />
                <q-btn dense flat icon="content_paste" label="粘贴" :disable="isReadonly || isSystemWorkflow" @click="pasteCodeFromClipboard" />
                <q-btn dense color="positive" icon="content_copy" label="复制代码" @click="copyCode" />
              </div>
              <q-input
                v-model="workflowCodeText"
                type="textarea"
                autogrow
                outlined
                dark
                :disable="isReadonly || isSystemWorkflow"
                input-style="font-family: Menlo, Monaco, Consolas, monospace; min-height: 520px;"
                @update:model-value="onCodeTextChange"
              />
            </q-tab-panel>
          </q-tab-panels>
        </q-card>
      </q-page>
    </q-page-container>
  </q-layout>
</template>
<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { copyToClipboard } from "quasar";
import { useRoute, useRouter } from "vue-router";
import {
  createWorkflow,
  duplicateWorkflow,
  getWorkflow,
  restoreWorkflowDefault,
  runWorkflow as runWorkflowApi,
  updateWorkflow,
  validateWorkflowGraph,
} from "src/api/workflow-api";
import { openTaskInMain } from "src/tauri-compat/core";
import { open as openDialog } from "src/tauri-compat/dialog";
import WorkflowBlueprintEditor from "src/components/workflow/WorkflowBlueprintEditor.vue";
import BoardNodeCard from "src/components/workflow/board/BoardNodeCard.vue";
import SystemWorkflowBoard from "src/components/workflow/board/SystemWorkflowBoard.vue";
import type { BuiltinWorkflowKind, WorkflowGraph, WorkflowSource } from "src/components/workflow/types";
import { useWorkflowBoard } from "./workflow-editor/use-workflow-board";
const route = useRoute();
const router = useRouter();
const form = reactive({
  name: "",
  description: "",
});
const graphModel = ref<WorkflowGraph>({
  nodes: [],
  edges: [],
});
const errorMsg = ref("");
const currentWorkflowId = ref("");
const currentWorkflowSource = ref<WorkflowSource>("user");
const currentWorkflowSystemKind = ref<BuiltinWorkflowKind>("custom");
const isReadonly = ref(false);
const editorTab = ref<"visual" | "board" | "code">("visual");
const workflowCodeText = ref("");
const codeDirty = ref(false);
const isSystemWorkflow = computed(() => currentWorkflowSource.value === "system");
const { boardSections, readNodeConfig, patchNodeConfig, handleBoardFieldUpdate } = useWorkflowBoard(graphModel, isReadonly);
const routeWorkflowId = computed(() => {
  const raw = Array.isArray(route.params.id) ? route.params.id[0] : route.params.id;
  return raw ? decodeURIComponent(String(raw)) : "new";
});
function closeWindow() {
  window.close();
}
function buildCodePayload(): { name: string; description: string; graph: WorkflowGraph } {
  return {
    name: form.name,
    description: form.description,
    graph: graphModel.value,
  };
}
function syncCodeFromCanvas() {
  workflowCodeText.value = JSON.stringify(buildCodePayload(), null, 2);
  codeDirty.value = false;
}
function onCodeTextChange() {
  codeDirty.value = true;
}

function normalizeTypeIdPrefix(nodeType: string): string {
  const normalized = nodeType.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized || "node";
}

function normalizeGraphShape(value: unknown): WorkflowGraph {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

  const rawNodes = (Array.isArray(raw.nodes) ? raw.nodes : [])
    .map((item, idx) => {
      const node = item && typeof item === "object" && !Array.isArray(item) ? (item as Record<string, unknown>) : {};
      const type = typeof node.type === "string" ? node.type.trim() : "";
      if (!type) {
        return null;
      }

      const idRaw = typeof node.id === "string" ? node.id.trim() : "";
      const config = node.config && typeof node.config === "object" && !Array.isArray(node.config)
        ? (node.config as Record<string, unknown>)
        : {};
      const remark = typeof node.remark === "string" ? node.remark.trim() : "";
      const positionRaw = node.position && typeof node.position === "object" && !Array.isArray(node.position)
        ? (node.position as Record<string, unknown>)
        : {};
      const positionX = Number(positionRaw.x);
      const positionY = Number(positionRaw.y);

      return {
        __rawId: idRaw || `node_${String(idx + 1)}`,
        type,
        ...(remark ? { remark } : {}),
        config,
        ...(Number.isFinite(positionX) && Number.isFinite(positionY)
          ? {
              position: {
                x: positionX,
                y: positionY,
              },
            }
          : {}),
      };
    })
    .filter((item): item is WorkflowGraph["nodes"][number] & { __rawId: string } => item !== null);

  const counters = new Map<string, number>();
  const idMap = new Map<string, string>();
  const nodes: WorkflowGraph["nodes"] = rawNodes.map((node) => {
    const prefix = normalizeTypeIdPrefix(node.type);
    const nextIndex = (counters.get(prefix) || 0) + 1;
    counters.set(prefix, nextIndex);
    const id = `${prefix}_${String(nextIndex)}`;
    idMap.set(node.__rawId, id);
    return {
      id,
      type: node.type,
      ...(node.remark ? { remark: node.remark } : {}),
      config: node.config,
      ...(node.position ? { position: node.position } : {}),
    };
  });

  const edges = (Array.isArray(raw.edges) ? raw.edges : [])
    .map((item, idx) => {
      const edge = item && typeof item === "object" && !Array.isArray(item) ? (item as Record<string, unknown>) : {};
      const source = typeof edge.source === "string" ? edge.source.trim() : "";
      const target = typeof edge.target === "string" ? edge.target.trim() : "";
      const mappedSource = idMap.get(source);
      const mappedTarget = idMap.get(target);
      if (!mappedSource || !mappedTarget) {
        return null;
      }

      const id = typeof edge.id === "string" && edge.id.trim().length > 0 ? edge.id.trim() : `edge_${String(idx + 1)}`;
      const sourceHandle = typeof edge.sourceHandle === "string" ? edge.sourceHandle.trim() : "";
      const targetHandle = typeof edge.targetHandle === "string" ? edge.targetHandle.trim() : "";

      return {
        id,
        source: mappedSource,
        target: mappedTarget,
        ...(sourceHandle ? { sourceHandle } : {}),
        ...(targetHandle ? { targetHandle } : {}),
      };
    })
    .filter((item): item is WorkflowGraph["edges"][number] => item !== null);

  return { nodes, edges };
}
async function handleBoardPickPath(payload: { nodeId: string; key: string; directory: boolean }) {
  await pickNodePath(payload.nodeId, payload.key, payload.directory);
}
async function pickNodePath(nodeId: string, configKey: string, directory: boolean) {
  if (isReadonly.value) {
    return;
  }
  errorMsg.value = "";
  try {
    const selected = await openDialog({
      directory,
      multiple: false,
      title: directory ? "选择目录" : "选择视频文件",
      filters: directory
        ? undefined
        : [
            {
              name: "视频文件",
              extensions: ["mp4"],
            },
          ],
    });
    if (typeof selected !== "string" || !selected) {
      return;
    }
    patchNodeConfig(nodeId, configKey, selected);
  } catch (error) {
    errorMsg.value = `选择路径失败: ${String(error)}`;
  }
}
async function applyCodeToCanvas(): Promise<boolean> {
  if (isReadonly.value || isSystemWorkflow.value) {
    errorMsg.value = "系统工作流不支持代码改图，请使用流程图或小白看板修改参数";
    return false;
  }
  errorMsg.value = "";
  try {
    const parsed = JSON.parse(workflowCodeText.value) as unknown;
    const root = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    const maybeGraph = root.graph !== undefined ? root.graph : parsed;
    const nextGraph = normalizeGraphShape(maybeGraph);
    const result = await validateWorkflowGraph(nextGraph);
    if (!result.valid) {
      errorMsg.value = `代码视图校验失败: ${result.issues.join("; ")}`;
      return false;
    }
    if (typeof root.name === "string") {
      form.name = root.name;
    }
    if (typeof root.description === "string") {
      form.description = root.description;
    }
    graphModel.value = nextGraph;
    syncCodeFromCanvas();
    return true;
  } catch (error) {
    errorMsg.value = `代码解析失败: ${String(error)}`;
    return false;
  }
}
async function copyCode() {
  errorMsg.value = "";
  if (!workflowCodeText.value.trim()) {
    syncCodeFromCanvas();
  }
  try {
    await copyToClipboard(workflowCodeText.value);
  } catch (error) {
    errorMsg.value = `复制失败: ${String(error)}`;
  }
}
async function pasteCodeFromClipboard() {
  if (isReadonly.value || isSystemWorkflow.value) {
    return;
  }
  errorMsg.value = "";
  try {
    const text = await navigator.clipboard.readText();
    if (!text.trim()) {
      errorMsg.value = "剪贴板内容为空";
      return;
    }
    workflowCodeText.value = text;
    codeDirty.value = true;
  } catch (error) {
    errorMsg.value = `读取剪贴板失败: ${String(error)}`;
  }
}
async function reloadWorkflow() {
  errorMsg.value = "";
  const id = routeWorkflowId.value;
  if (!id || id === "new") {
    currentWorkflowId.value = "";
    currentWorkflowSource.value = "user";
    currentWorkflowSystemKind.value = "custom";
    isReadonly.value = false;
    form.name = "";
    form.description = "";
    graphModel.value = { nodes: [], edges: [] };
    syncCodeFromCanvas();
    return;
  }
  try {
    const detail = await getWorkflow(id);
    currentWorkflowId.value = detail.id;
    currentWorkflowSource.value = detail.source;
    currentWorkflowSystemKind.value = detail.systemKind;
    isReadonly.value = detail.readonly;
    form.name = detail.name;
    form.description = detail.description;
    graphModel.value = detail.graph;
    syncCodeFromCanvas();
  } catch (error) {
    errorMsg.value = String(error);
  }
}
async function restoreDefaultWorkflow() {
  if (!currentWorkflowId.value || !isSystemWorkflow.value) {
    return;
  }
  errorMsg.value = "";
  try {
    await restoreWorkflowDefault(currentWorkflowId.value);
    await reloadWorkflow();
  } catch (error) {
    errorMsg.value = String(error);
  }
}
async function saveWorkflow() {
  if (isReadonly.value) {
    errorMsg.value = "内置工作流不可直接编辑，请使用另存为";
    return;
  }
  const name = form.name.trim();
  if (!name) {
    errorMsg.value = "工作流名称不能为空";
    return;
  }
  errorMsg.value = "";
  try {
    if (editorTab.value === "code" && codeDirty.value) {
      const ok = await applyCodeToCanvas();
      if (!ok) {
        return;
      }
    }
    if (!currentWorkflowId.value) {
      const created = await createWorkflow({
        name,
        description: form.description,
        graph: graphModel.value,
      });
      currentWorkflowId.value = created.id;
      await router.replace(`/workflow-editor/${encodeURIComponent(created.id)}`);
      await reloadWorkflow();
      return;
    }
    const updated = await updateWorkflow({
      id: currentWorkflowId.value,
      name,
      description: form.description,
      graph: graphModel.value,
    });
    currentWorkflowId.value = updated.id;
    await reloadWorkflow();
  } catch (error) {
    errorMsg.value = String(error);
  }
}
async function saveAsCopy() {
  errorMsg.value = "";
  try {
    if (!currentWorkflowId.value) {
      await saveWorkflow();
      return;
    }
    const duplicated = await duplicateWorkflow(currentWorkflowId.value, `${form.name || "未命名工作流"} 副本`);
    currentWorkflowId.value = duplicated.id;
    isReadonly.value = false;
    await router.replace(`/workflow-editor/${encodeURIComponent(duplicated.id)}`);
    await reloadWorkflow();
  } catch (error) {
    errorMsg.value = String(error);
  }
}
async function handleRunWorkflow() {
  if (!currentWorkflowId.value) {
    errorMsg.value = "请先保存工作流再运行";
    return;
  }
  errorMsg.value = "";
  try {
    if (editorTab.value === "code" && codeDirty.value) {
      const ok = await applyCodeToCanvas();
      if (!ok) {
        return;
      }
    }
    const task = await runWorkflowApi({
      id: currentWorkflowId.value,
      runtimeInput: {},
      graph: graphModel.value,
    });
    if (!task?.id) {
      throw new Error("运行失败：未获取到任务 ID");
    }
    await openTaskInMain(task.id);
  } catch (error) {
    errorMsg.value = String(error);
  }
}
onMounted(async () => {
  await reloadWorkflow();
});
watch(
  () => editorTab.value,
  (tab) => {
    if (tab === "code" && !codeDirty.value) {
      syncCodeFromCanvas();
    }
  },
);
watch(
  () => [form.name, form.description, graphModel.value],
  () => {
    if (editorTab.value !== "code" && !codeDirty.value) {
      syncCodeFromCanvas();
    }
  },
  { deep: true },
);
</script>
<style scoped>
.editor-layout {
  background: #0b1220;
}
.editor-page {
  min-height: calc(100vh - 52px);
}
.metadata-card {
  background: #111827;
  color: #e5e7eb;
}
.editor-content-card {
  overflow: hidden;
}
:deep(.q-tab-panel) {
  background: transparent;
}
.form-board {
  min-height: 540px;
}
.board-section-title {
  font-size: 14px;
  font-weight: 600;
  color: #f1f5f9;
  margin-bottom: 10px;
}
.board-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 12px;
}
.board-empty-card {
  background: #0f172a;
  border-color: #243043;
  color: #e5e7eb;
}
</style>
