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
              <WorkflowBlueprintEditor v-model="graphModel" :readonly="isReadonly" />
            </q-tab-panel>

            <q-tab-panel name="board" class="q-pa-sm">
              <div class="form-board">
                <q-banner dense rounded class="bg-grey-9 text-grey-4 q-mb-md">
                  表单看板仅展示配置卡片：必填项在上，可选项在中，有默认值项在下。
                </q-banner>

                <div class="board-section-title">必填配置</div>
                <div class="board-card-grid q-mb-md">
                  <q-card
                    v-for="card in requiredBoardCards"
                    :key="`required-${card.nodeId}`"
                    flat
                    bordered
                    class="board-node-card"
                  >
                    <q-card-section class="q-pb-sm">
                      <div class="text-subtitle2 text-weight-medium">{{ card.nodeLabel }}</div>
                      <div class="text-caption text-grey-5">{{ card.nodeTypeLabel }} ({{ card.nodeType }})</div>
                    </q-card-section>
                    <q-separator dark />
                    <q-card-section class="q-pt-sm">
                      <template v-if="card.fields.length > 0">
                        <div v-for="field in card.fields" :key="`${card.nodeId}-${field.key}`" class="q-mb-sm">
                          <q-input
                            v-if="field.kind === 'text' || field.kind === 'directory' || field.kind === 'video'"
                            :disable="isReadonly"
                            :label="field.label"
                            :placeholder="field.placeholder"
                            :model-value="readStringField(card.nodeId, field)"
                            outlined
                            dense
                            @update:model-value="writeStringField(card.nodeId, field, $event)"
                          >
                            <template #append>
                              <q-btn
                                v-if="field.kind === 'directory'"
                                flat
                                round
                                dense
                                icon="folder_open"
                                :disable="isReadonly"
                                @click="pickNodePath(card.nodeId, field.key, true)"
                              />
                              <q-btn
                                v-else-if="field.kind === 'video'"
                                flat
                                round
                                dense
                                icon="movie"
                                :disable="isReadonly"
                                @click="pickNodePath(card.nodeId, field.key, false)"
                              />
                            </template>
                          </q-input>
                          <q-input
                            v-else-if="field.kind === 'textarea'"
                            :disable="isReadonly"
                            :label="field.label"
                            :placeholder="field.placeholder"
                            :model-value="readStringField(card.nodeId, field)"
                            type="textarea"
                            autogrow
                            outlined
                            dense
                            @update:model-value="writeStringField(card.nodeId, field, $event)"
                          />
                          <q-input
                            v-else-if="field.kind === 'number'"
                            :disable="isReadonly"
                            :label="field.label"
                            :model-value="readNumberField(card.nodeId, field)"
                            :min="field.min"
                            :max="field.max"
                            :step="field.step || 1"
                            type="number"
                            outlined
                            dense
                            @update:model-value="writeNumberField(card.nodeId, field, $event)"
                          />
                          <q-select
                            v-else-if="field.kind === 'select'"
                            :disable="isReadonly"
                            :label="field.label"
                            :model-value="readSelectField(card.nodeId, field)"
                            :options="field.options || []"
                            option-label="label"
                            option-value="value"
                            emit-value
                            map-options
                            outlined
                            dense
                            @update:model-value="writeSelectField(card.nodeId, field, $event)"
                          />
                          <q-checkbox
                            v-else-if="field.kind === 'boolean'"
                            :disable="isReadonly"
                            :label="field.label"
                            :model-value="readBooleanField(card.nodeId, field)"
                            color="primary"
                            @update:model-value="writeBooleanField(card.nodeId, field, $event)"
                          />
                          <div v-if="field.helpText" class="text-caption text-grey-5 q-mt-xs">{{ field.helpText }}</div>
                        </div>
                      </template>
                      <div v-else class="text-caption text-grey-5">当前节点没有可编辑表单项</div>
                    </q-card-section>
                  </q-card>
                  <q-card v-if="requiredBoardCards.length === 0" flat bordered class="board-empty-card">
                    <q-card-section class="text-caption text-grey-5">没有必填配置节点</q-card-section>
                  </q-card>
                </div>

                <div class="board-section-title">可选配置</div>
                <div class="board-card-grid q-mb-md">
                  <q-card
                    v-for="card in optionalBoardCards"
                    :key="`optional-${card.nodeId}`"
                    flat
                    bordered
                    class="board-node-card"
                  >
                    <q-card-section class="q-pb-sm">
                      <div class="text-subtitle2 text-weight-medium">{{ card.nodeLabel }}</div>
                      <div class="text-caption text-grey-5">{{ card.nodeTypeLabel }} ({{ card.nodeType }})</div>
                    </q-card-section>
                    <q-separator dark />
                    <q-card-section class="q-pt-sm">
                      <div v-for="field in card.fields" :key="`${card.nodeId}-${field.key}`" class="q-mb-sm">
                        <q-input
                          v-if="field.kind === 'text' || field.kind === 'directory' || field.kind === 'video'"
                          :disable="isReadonly"
                          :label="field.label"
                          :placeholder="field.placeholder"
                          :model-value="readStringField(card.nodeId, field)"
                          outlined
                          dense
                          @update:model-value="writeStringField(card.nodeId, field, $event)"
                        >
                          <template #append>
                            <q-btn
                              v-if="field.kind === 'directory'"
                              flat
                              round
                              dense
                              icon="folder_open"
                              :disable="isReadonly"
                              @click="pickNodePath(card.nodeId, field.key, true)"
                            />
                            <q-btn
                              v-else-if="field.kind === 'video'"
                              flat
                              round
                              dense
                              icon="movie"
                              :disable="isReadonly"
                              @click="pickNodePath(card.nodeId, field.key, false)"
                            />
                          </template>
                        </q-input>
                        <q-input
                          v-else-if="field.kind === 'textarea'"
                          :disable="isReadonly"
                          :label="field.label"
                          :placeholder="field.placeholder"
                          :model-value="readStringField(card.nodeId, field)"
                          type="textarea"
                          autogrow
                          outlined
                          dense
                          @update:model-value="writeStringField(card.nodeId, field, $event)"
                        />
                        <q-input
                          v-else-if="field.kind === 'number'"
                          :disable="isReadonly"
                          :label="field.label"
                          :model-value="readNumberField(card.nodeId, field)"
                          :min="field.min"
                          :max="field.max"
                          :step="field.step || 1"
                          type="number"
                          outlined
                          dense
                          @update:model-value="writeNumberField(card.nodeId, field, $event)"
                        />
                        <q-select
                          v-else-if="field.kind === 'select'"
                          :disable="isReadonly"
                          :label="field.label"
                          :model-value="readSelectField(card.nodeId, field)"
                          :options="field.options || []"
                          option-label="label"
                          option-value="value"
                          emit-value
                          map-options
                          outlined
                          dense
                          @update:model-value="writeSelectField(card.nodeId, field, $event)"
                        />
                        <q-checkbox
                          v-else-if="field.kind === 'boolean'"
                          :disable="isReadonly"
                          :label="field.label"
                          :model-value="readBooleanField(card.nodeId, field)"
                          color="primary"
                          @update:model-value="writeBooleanField(card.nodeId, field, $event)"
                        />
                        <div v-if="field.helpText" class="text-caption text-grey-5 q-mt-xs">{{ field.helpText }}</div>
                      </div>
                    </q-card-section>
                  </q-card>
                  <q-card v-if="optionalBoardCards.length === 0" flat bordered class="board-empty-card">
                    <q-card-section class="text-caption text-grey-5">没有可选配置节点</q-card-section>
                  </q-card>
                </div>

                <div class="board-section-title">默认配置（可直接运行）</div>
                <div class="board-card-grid">
                  <q-card
                    v-for="card in defaultBoardCards"
                    :key="`default-${card.nodeId}`"
                    flat
                    bordered
                    class="board-node-card"
                  >
                    <q-card-section class="q-pb-sm">
                      <div class="text-subtitle2 text-weight-medium">{{ card.nodeLabel }}</div>
                      <div class="text-caption text-grey-5">{{ card.nodeTypeLabel }} ({{ card.nodeType }})</div>
                    </q-card-section>
                    <q-separator dark />
                    <q-card-section class="q-pt-sm">
                      <div v-for="field in card.fields" :key="`${card.nodeId}-${field.key}`" class="q-mb-sm">
                        <q-input
                          v-if="field.kind === 'text' || field.kind === 'directory' || field.kind === 'video'"
                          :disable="isReadonly"
                          :label="field.label"
                          :placeholder="field.placeholder"
                          :model-value="readStringField(card.nodeId, field)"
                          outlined
                          dense
                          @update:model-value="writeStringField(card.nodeId, field, $event)"
                        >
                          <template #append>
                            <q-btn
                              v-if="field.kind === 'directory'"
                              flat
                              round
                              dense
                              icon="folder_open"
                              :disable="isReadonly"
                              @click="pickNodePath(card.nodeId, field.key, true)"
                            />
                            <q-btn
                              v-else-if="field.kind === 'video'"
                              flat
                              round
                              dense
                              icon="movie"
                              :disable="isReadonly"
                              @click="pickNodePath(card.nodeId, field.key, false)"
                            />
                          </template>
                        </q-input>
                        <q-input
                          v-else-if="field.kind === 'textarea'"
                          :disable="isReadonly"
                          :label="field.label"
                          :placeholder="field.placeholder"
                          :model-value="readStringField(card.nodeId, field)"
                          type="textarea"
                          autogrow
                          outlined
                          dense
                          @update:model-value="writeStringField(card.nodeId, field, $event)"
                        />
                        <q-input
                          v-else-if="field.kind === 'number'"
                          :disable="isReadonly"
                          :label="field.label"
                          :model-value="readNumberField(card.nodeId, field)"
                          :min="field.min"
                          :max="field.max"
                          :step="field.step || 1"
                          type="number"
                          outlined
                          dense
                          @update:model-value="writeNumberField(card.nodeId, field, $event)"
                        />
                        <q-select
                          v-else-if="field.kind === 'select'"
                          :disable="isReadonly"
                          :label="field.label"
                          :model-value="readSelectField(card.nodeId, field)"
                          :options="field.options || []"
                          option-label="label"
                          option-value="value"
                          emit-value
                          map-options
                          outlined
                          dense
                          @update:model-value="writeSelectField(card.nodeId, field, $event)"
                        />
                        <q-checkbox
                          v-else-if="field.kind === 'boolean'"
                          :disable="isReadonly"
                          :label="field.label"
                          :model-value="readBooleanField(card.nodeId, field)"
                          color="primary"
                          @update:model-value="writeBooleanField(card.nodeId, field, $event)"
                        />
                        <div v-if="field.helpText" class="text-caption text-grey-5 q-mt-xs">{{ field.helpText }}</div>
                      </div>
                    </q-card-section>
                  </q-card>
                  <q-card v-if="defaultBoardCards.length === 0" flat bordered class="board-empty-card">
                    <q-card-section class="text-caption text-grey-5">没有默认配置节点</q-card-section>
                  </q-card>
                </div>
              </div>
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
import { open as openDialog } from "src/tauri-compat/dialog";
import WorkflowBlueprintEditor from "src/components/workflow/WorkflowBlueprintEditor.vue";
import type { WorkflowDefinition, WorkflowGraph, WorkflowSource } from "src/components/workflow/types";
import { WORKFLOW_NODE_MACRO_MAP } from "src/shared/workflow-node-macros";

type BoardFieldKind = "text" | "textarea" | "number" | "boolean" | "select" | "directory" | "video";

interface BoardFieldOption {
  label: string;
  value: string;
}

interface BoardFieldSchema {
  key: string;
  label: string;
  kind: BoardFieldKind;
  required?: boolean;
  defaultValue?: unknown;
  placeholder?: string;
  helpText?: string;
  options?: BoardFieldOption[];
  min?: number;
  max?: number;
  step?: number;
  showWhen?: (config: Record<string, unknown>) => boolean;
}

interface BoardCard {
  nodeId: string;
  nodeLabel: string;
  nodeType: string;
  nodeTypeLabel: string;
  category: "required" | "optional" | "default";
  fields: BoardFieldSchema[];
  orderKey: number;
}

const NODE_BOARD_SCHEMAS: Record<string, BoardFieldSchema[]> = {
  input_dir: [
    {
      key: "inputDir",
      label: "输入目录",
      kind: "directory",
      required: true,
      placeholder: "/path/to/input",
    },
  ],
  output_dir: [
    {
      key: "outputDir",
      label: "输出目录",
      kind: "directory",
      required: true,
      placeholder: "/path/to/output",
    },
  ],
  user_input: [
    {
      key: "text",
      label: "文本输入",
      kind: "textarea",
      required: true,
      placeholder: "每行一个 URL",
    },
  ],
  text_split: [
    {
      key: "mode",
      label: "拆分方式",
      kind: "select",
      defaultValue: "newline",
      options: [
        { label: "按换行", value: "newline" },
        { label: "按逗号", value: "comma" },
        { label: "按空白", value: "space" },
        { label: "自定义", value: "custom" },
      ],
    },
    {
      key: "customSeparator",
      label: "自定义分隔符",
      kind: "text",
      placeholder: "例如: ||",
      showWhen: (config) => String(config.mode || "newline") === "custom",
    },
    {
      key: "trim",
      label: "自动 trim",
      kind: "boolean",
      defaultValue: true,
    },
    {
      key: "removeEmpty",
      label: "移除空项",
      kind: "boolean",
      defaultValue: true,
    },
  ],
  file: [
    {
      key: "recursive",
      label: "递归读取",
      kind: "boolean",
      defaultValue: true,
    },
    {
      key: "maxDepth",
      label: "递归层数",
      kind: "number",
      defaultValue: 2,
      min: 0,
      step: 1,
    },
  ],
  network: [
    {
      key: "maxConcurrent",
      label: "并发数",
      kind: "number",
      defaultValue: 3,
      min: 1,
      step: 1,
    },
    {
      key: "asyncDownload",
      label: "异步并发下载",
      kind: "boolean",
      defaultValue: true,
    },
  ],
  select_video: [
    {
      key: "videoPath",
      label: "视频路径",
      kind: "video",
      placeholder: "/path/to/video.mp4",
    },
    {
      key: "required",
      label: "设为必填",
      kind: "boolean",
      defaultValue: false,
    },
  ],
  random_concat: [
    {
      key: "randomCountMin",
      label: "随机最小数量",
      kind: "number",
      defaultValue: 2,
      min: 1,
      step: 1,
    },
    {
      key: "randomCountMax",
      label: "随机最大数量",
      kind: "number",
      defaultValue: 4,
      min: 1,
      step: 1,
    },
    {
      key: "runTimes",
      label: "生成次数",
      kind: "number",
      defaultValue: 1,
      min: 1,
      step: 1,
    },
  ],
  remove_ending: [
    {
      key: "shuffleSegments",
      label: "随机打乱片段",
      kind: "boolean",
      defaultValue: false,
    },
    {
      key: "newEndingVideo",
      label: "新结尾视频(可选)",
      kind: "video",
      placeholder: "/path/to/ending.mp4",
    },
  ],
  video: [
    {
      key: "action",
      label: "动作",
      kind: "select",
      defaultValue: "split_profile",
      options: [
        { label: "拆解参数", value: "split_profile" },
        { label: "自动拆解", value: "auto_split" },
        { label: "去结尾", value: "remove_ending" },
        { label: "拼接(兼容旧流)", value: "concat" },
        { label: "按片段生成", value: "split_segments" },
      ],
    },
    {
      key: "algorithm",
      label: "算法",
      kind: "select",
      defaultValue: "ssim",
      options: [
        { label: "SSIM", value: "ssim" },
        { label: "直方图", value: "histogram" },
        { label: "帧差异", value: "frame_diff" },
      ],
      showWhen: (config) => {
        const action = String(config.action || "split_profile");
        return action === "split_profile" || action === "auto_split" || action === "remove_ending";
      },
    },
    {
      key: "threshold",
      label: "阈值",
      kind: "number",
      defaultValue: 0.7,
      min: 0,
      max: 1,
      step: 0.01,
      showWhen: (config) => {
        const action = String(config.action || "split_profile");
        return action === "split_profile" || action === "auto_split" || action === "remove_ending";
      },
    },
    {
      key: "minDuration",
      label: "最小时长",
      kind: "number",
      defaultValue: 2,
      min: 0,
      step: 0.1,
      showWhen: (config) => {
        const action = String(config.action || "split_profile");
        return action === "split_profile" || action === "auto_split" || action === "remove_ending";
      },
    },
    {
      key: "skipFirst",
      label: "跳过首片段",
      kind: "boolean",
      defaultValue: false,
      showWhen: (config) => {
        const action = String(config.action || "split_profile");
        return action === "split_profile" || action === "auto_split" || action === "remove_ending";
      },
    },
    {
      key: "skipLast",
      label: "跳过最后片段",
      kind: "boolean",
      defaultValue: true,
      showWhen: (config) => {
        const action = String(config.action || "split_profile");
        return action === "split_profile" || action === "auto_split" || action === "remove_ending";
      },
    },
    {
      key: "shuffleSegments",
      label: "随机打乱片段",
      kind: "boolean",
      defaultValue: false,
      showWhen: (config) => String(config.action || "split_profile") === "remove_ending",
    },
    {
      key: "newEndingVideo",
      label: "新结尾视频(可选)",
      kind: "video",
      placeholder: "/path/to/ending.mp4",
      showWhen: (config) => String(config.action || "split_profile") === "remove_ending",
    },
  ],
};

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
const editorTab = ref<"visual" | "board" | "code">("visual");
const workflowCodeText = ref("");
const codeDirty = ref(false);
const isSystemWorkflow = computed(() => currentWorkflowSource.value === "system");
const boardCards = computed<BoardCard[]>(() => {
  const cards = graphModel.value.nodes.map((node, idx) => {
    const config = readNodeConfig(node.id);
    const sourceFields = NODE_BOARD_SCHEMAS[node.type] || [];
    const fields = sourceFields.filter((field) => {
      return field.showWhen ? field.showWhen(config) : true;
    });
    const category = resolveBoardCategory(fields);
    const x = Number.isFinite(node.position?.x) ? Number(node.position?.x) : idx * 100;
    const y = Number.isFinite(node.position?.y) ? Number(node.position?.y) : 0;
    return {
      nodeId: node.id,
      nodeLabel: node.label || node.id,
      nodeType: node.type,
      nodeTypeLabel: WORKFLOW_NODE_MACRO_MAP[node.type]?.label || node.type,
      category,
      fields,
      orderKey: y * 10000 + x,
    };
  });
  cards.sort((a, b) => {
    const priorityA = boardCategoryPriority(a.category);
    const priorityB = boardCategoryPriority(b.category);
    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }
    return a.orderKey - b.orderKey;
  });
  return cards;
});
const requiredBoardCards = computed(() => boardCards.value.filter((card) => card.category === "required"));
const optionalBoardCards = computed(() => boardCards.value.filter((card) => card.category === "optional"));
const defaultBoardCards = computed(() => boardCards.value.filter((card) => card.category === "default"));

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

function readNodeConfig(nodeId: string): Record<string, unknown> {
  const node = graphModel.value.nodes.find((item) => item.id === nodeId);
  const config = node?.config;
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return {};
  }
  return config as Record<string, unknown>;
}

function boardCategoryPriority(category: BoardCard["category"]): number {
  if (category === "required") {
    return 0;
  }
  if (category === "optional") {
    return 1;
  }
  return 2;
}

function resolveBoardCategory(fields: BoardFieldSchema[]): BoardCard["category"] {
  if (fields.length === 0) {
    return "default";
  }
  if (fields.some((field) => field.required)) {
    return "required";
  }
  if (fields.some((field) => field.defaultValue === undefined)) {
    return "optional";
  }
  return "default";
}

function readFieldRawValue(nodeId: string, field: BoardFieldSchema): unknown {
  const config = readNodeConfig(nodeId);
  if (field.key in config) {
    return config[field.key];
  }
  return field.defaultValue;
}

function readStringField(nodeId: string, field: BoardFieldSchema): string {
  const raw = readFieldRawValue(nodeId, field);
  return typeof raw === "string" ? raw : raw === undefined || raw === null ? "" : String(raw);
}

function readNumberField(nodeId: string, field: BoardFieldSchema): number | null {
  const raw = readFieldRawValue(nodeId, field);
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return null;
  }
  return value;
}

function readBooleanField(nodeId: string, field: BoardFieldSchema): boolean {
  const raw = readFieldRawValue(nodeId, field);
  if (typeof raw === "boolean") {
    return raw;
  }
  return Boolean(raw);
}

function readSelectField(nodeId: string, field: BoardFieldSchema): string {
  const raw = readFieldRawValue(nodeId, field);
  if (typeof raw === "string") {
    return raw;
  }
  return typeof field.defaultValue === "string" ? field.defaultValue : "";
}

function patchNodeConfig(nodeId: string, key: string, value: unknown) {
  if (isReadonly.value) {
    return;
  }
  graphModel.value = {
    ...graphModel.value,
    nodes: graphModel.value.nodes.map((node) => {
      if (node.id !== nodeId) {
        return node;
      }
      const currentConfig = node.config && typeof node.config === "object" && !Array.isArray(node.config)
        ? (node.config as Record<string, unknown>)
        : {};
      const nextConfig: Record<string, unknown> = {
        ...currentConfig,
      };
      const shouldDelete =
        value === undefined ||
        value === null ||
        (typeof value === "string" && value.trim().length === 0) ||
        (typeof value === "number" && !Number.isFinite(value));
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
}

function writeStringField(nodeId: string, field: BoardFieldSchema, value: string | number | null) {
  patchNodeConfig(nodeId, field.key, typeof value === "string" ? value : value == null ? "" : String(value));
}

function writeNumberField(nodeId: string, field: BoardFieldSchema, value: string | number | null) {
  if (value === null || value === "") {
    patchNodeConfig(nodeId, field.key, undefined);
    return;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    patchNodeConfig(nodeId, field.key, undefined);
    return;
  }
  patchNodeConfig(nodeId, field.key, number);
}

function writeBooleanField(nodeId: string, field: BoardFieldSchema, value: boolean) {
  patchNodeConfig(nodeId, field.key, Boolean(value));
}

function writeSelectField(nodeId: string, field: BoardFieldSchema, value: string | null) {
  patchNodeConfig(nodeId, field.key, value ?? "");
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

.board-node-card,
.board-empty-card {
  background: #0f172a;
  border-color: #243043;
  color: #e5e7eb;
}
</style>
