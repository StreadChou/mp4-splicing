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
                :disable="isReadonly"
                hint="名称不可重复（忽略大小写和首尾空格）"
              />
            </div>
            <div class="col-12 col-md-7">
              <q-input
                v-model="form.description"
                label="描述"
                outlined
                autogrow
                :disable="isReadonly"
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
              <WorkflowBlueprintEditor v-model="graphModel" :readonly="isReadonly" />
            </q-tab-panel>

            <q-tab-panel name="code" class="q-pa-sm">
              <div class="row items-center q-gutter-sm q-mb-sm">
                <q-btn dense flat icon="sync" label="从流程图生成" @click="syncCodeFromCanvas" />
                <q-btn dense color="primary" icon="published_with_changes" label="应用到流程图" :disable="isReadonly" @click="applyCodeToCanvas" />
                <q-space />
                <q-btn dense flat icon="content_paste" label="粘贴" :disable="isReadonly" @click="pasteCodeFromClipboard" />
                <q-btn dense color="positive" icon="content_copy" label="复制代码" @click="copyCode" />
              </div>
              <q-input
                v-model="workflowCodeText"
                type="textarea"
                autogrow
                outlined
                dark
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
import WorkflowBlueprintEditor from "src/components/workflow/WorkflowBlueprintEditor.vue";
import type { WorkflowDefinition, WorkflowGraph, WorkflowSource } from "src/components/workflow/types";

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
const isReadonly = ref(false);
const editorTab = ref<"visual" | "code">("visual");
const workflowCodeText = ref("");
const codeDirty = ref(false);
const isSystemWorkflow = computed(() => currentWorkflowSource.value === "system");

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

function normalizeGraphShape(value: unknown): WorkflowGraph {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const nodes = Array.isArray(raw.nodes) ? (raw.nodes as WorkflowGraph["nodes"]) : [];
  const edges = Array.isArray(raw.edges) ? (raw.edges as WorkflowGraph["edges"]) : [];
  return { nodes, edges };
}

async function applyCodeToCanvas(): Promise<boolean> {
  if (isReadonly.value) {
    errorMsg.value = "内置工作流不可直接编辑，请使用另存为";
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
  if (isReadonly.value) {
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
</style>
