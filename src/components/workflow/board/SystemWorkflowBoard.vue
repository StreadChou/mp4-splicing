<template>
  <div class="system-board">
    <q-banner dense rounded class="bg-teal-1 text-teal-10 q-mb-md">
      小白看板：仅保留关键参数，按步骤分块设置。
    </q-banner>

    <q-card
      v-for="section in resolvedSections"
      :key="section.key"
      flat
      bordered
      class="system-board-section q-mb-md"
    >
      <q-card-section>
        <div class="text-subtitle1 text-weight-medium">{{ section.title }}</div>
        <div v-if="section.description" class="text-caption text-grey-5 q-mt-xs">{{ section.description }}</div>
      </q-card-section>
      <q-separator />
      <q-card-section>
        <div class="row q-col-gutter-md">
          <div
            v-for="field in section.fields"
            :key="field.id"
            :class="field.fullWidth === true ? 'col-12' : field.inlinePair === true ? 'col-6' : 'col-12 col-md-6'"
          >
            <q-input
              v-if="field.kind === 'text' || field.kind === 'directory' || field.kind === 'video'"
              :label="field.label"
              outlined
              :disable="readonly"
              :placeholder="field.placeholder"
              :model-value="stringValue(field)"
              @update:model-value="writeString(field, $event)"
            >
              <template #append>
                <q-btn
                  v-if="field.kind === 'directory'"
                  flat
                  round
                  dense
                  icon="folder_open"
                  :disable="readonly"
                  @click="pickPath(field, true)"
                />
                <q-btn
                  v-else-if="field.kind === 'video'"
                  flat
                  round
                  dense
                  icon="movie"
                  :disable="readonly"
                  @click="pickPath(field, false)"
                />
              </template>
            </q-input>

            <q-input
              v-else-if="field.kind === 'textarea'"
              :label="field.label"
              type="textarea"
              :rows="field.rows || 4"
              autogrow
              outlined
              :disable="readonly"
              :placeholder="field.placeholder"
              :model-value="stringValue(field)"
              @update:model-value="writeString(field, $event)"
            />

            <q-input
              v-else-if="field.kind === 'number'"
              :label="field.label"
              type="number"
              outlined
              :disable="readonly"
              :min="field.min"
              :max="field.max"
              :step="field.step || 1"
              :model-value="numberValue(field)"
              @update:model-value="writeNumber(field, $event)"
            />

            <q-select
              v-else-if="field.kind === 'select'"
              :label="field.label"
              outlined
              emit-value
              map-options
              option-label="label"
              option-value="value"
              :disable="readonly"
              :options="field.options || []"
              :model-value="selectValue(field)"
              @update:model-value="writeSelect(field, $event)"
            />

            <q-checkbox
              v-else-if="field.kind === 'boolean'"
              :label="field.label"
              :disable="readonly"
              color="primary"
              :model-value="booleanValue(field)"
              @update:model-value="writeBoolean(field, $event)"
            />

            <div v-if="field.helpText" class="text-caption text-grey-5 q-mt-xs">{{ field.helpText }}</div>
          </div>
        </div>
      </q-card-section>
    </q-card>

    <q-card v-if="resolvedSections.length === 0" flat bordered class="system-board-section">
      <q-card-section class="text-caption text-grey-5">
        当前系统流程没有可展示的简化参数。
      </q-card-section>
    </q-card>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { BuiltinWorkflowKind, WorkflowGraph } from "src/components/workflow/types";

interface FieldOption {
  label: string;
  value: string;
}

type FieldKind = "text" | "textarea" | "number" | "boolean" | "select" | "directory" | "video";

interface NodeMatch {
  type: string;
  remark?: string;
  nth?: number;
}

interface SystemBoardFieldSchema {
  id: string;
  label: string;
  kind: FieldKind;
  node: NodeMatch;
  key: string;
  derived?: "drop_head_tail_mode";
  inlinePair?: boolean;
  fullWidth?: boolean;
  rows?: number;
  placeholder?: string;
  helpText?: string;
  defaultValue?: unknown;
  min?: number;
  max?: number;
  step?: number;
  options?: FieldOption[];
}

interface SystemBoardSectionSchema {
  key: string;
  title: string;
  description?: string;
  fields: SystemBoardFieldSchema[];
}

interface ResolvedField extends SystemBoardFieldSchema {
  nodeId: string;
}

interface ResolvedSection {
  key: string;
  title: string;
  description?: string;
  fields: ResolvedField[];
}

const props = defineProps<{
  systemKind: BuiltinWorkflowKind;
  graph: WorkflowGraph;
  readonly?: boolean;
}>();

const emit = defineEmits<{
  "update-field": [payload: { nodeId: string; key: string; value: unknown }];
  "pick-path": [payload: { nodeId: string; key: string; directory: boolean }];
}>();

const readonly = computed(() => props.readonly === true);

const COMMON_TEXT_SPLIT_FIELDS: SystemBoardFieldSchema[] = [
  {
    id: "split_mode",
    label: "文本拆分方式",
    kind: "select",
    node: { type: "text_split", remark: "文本拆成列表" },
    key: "mode",
    defaultValue: "newline",
    options: [
      { label: "按换行", value: "newline" },
      { label: "按逗号", value: "comma" },
      { label: "按空白", value: "space" },
      { label: "自定义分隔符", value: "custom" },
    ],
  },
  {
    id: "split_custom",
    label: "自定义分隔符",
    kind: "text",
    node: { type: "text_split", remark: "文本拆成列表" },
    key: "customSeparator",
    placeholder: "例如: |",
  },
  {
    id: "split_trim",
    label: "去除首尾空白",
    kind: "boolean",
    node: { type: "text_split", remark: "文本拆成列表" },
    key: "trim",
    defaultValue: true,
  },
  {
    id: "split_empty",
    label: "移除空行",
    kind: "boolean",
    node: { type: "text_split", remark: "文本拆成列表" },
    key: "removeEmpty",
    defaultValue: true,
  },
];

const SYSTEM_BOARD_SCHEMAS: Record<BuiltinWorkflowKind, SystemBoardSectionSchema[]> = {
  batch_download: [
    {
      key: "download_basic",
      title: "下载设置",
      fields: [
        {
          id: "download_text",
          label: "视频链接文本",
          kind: "textarea",
          node: { type: "user_input", remark: "下载文本输入" },
          key: "text",
          fullWidth: true,
          placeholder: "每行一个 URL",
        },
        {
          id: "download_output_dir",
          label: "下载输出目录",
          kind: "directory",
          node: { type: "output_dir", remark: "下载输出目录" },
          key: "outputDir",
          fullWidth: true,
          placeholder: "/path/to/downloads",
        },
      ],
    },
  ],
  concat: [
    {
      key: "dirs",
      title: "1. 输入与输出",
      fields: [
        {
          id: "concat_input_dir",
          label: "视频输入目录",
          kind: "directory",
          node: { type: "input_dir", remark: "视频来源目录" },
          key: "inputDir",
        },
        {
          id: "concat_output_dir",
          label: "拼接输出目录",
          kind: "directory",
          node: { type: "output_dir", remark: "拼接输出目录" },
          key: "outputDir",
        },
      ],
    },
    {
      key: "compose",
      title: "2. 拼接设置",
      fields: [
        {
          id: "concat_times",
          label: "最终生成视频数量",
          kind: "number",
          node: { type: "repeat", remark: "循环生成次数" },
          key: "times",
          defaultValue: 1,
          min: 1,
          step: 1,
        },
        {
          id: "concat_random_min",
          label: "最少选择视频片段数",
          kind: "number",
          node: { type: "compose_videos", remark: "组合输出视频" },
          key: "randomCountMin",
          inlinePair: true,
          defaultValue: 2,
          min: -1,
          step: 1,
          helpText: "-1 表示使用全部候选视频",
        },
        {
          id: "concat_random_max",
          label: "最多选择视频片段数",
          kind: "number",
          node: { type: "compose_videos", remark: "组合输出视频" },
          key: "randomCountMax",
          inlinePair: true,
          defaultValue: 4,
          min: -1,
          step: 1,
          helpText: "-1 表示使用全部候选视频",
        },
        {
          id: "concat_end",
          label: "固定结尾视频(可选)",
          kind: "video",
          node: { type: "select_video", remark: "可选固定结尾" },
          key: "videoPath",
        },
      ],
    },
  ],
  auto_split: [
    {
      key: "dirs",
      title: "1. 输入与输出",
      fields: [
        {
          id: "auto_input",
          label: "输入目录",
          kind: "directory",
          node: { type: "input_dir", remark: "待拆解目录" },
          key: "inputDir",
        },
        {
          id: "auto_output",
          label: "输出目录",
          kind: "directory",
          node: { type: "output_dir", remark: "拆解输出目录" },
          key: "outputDir",
        },
        {
          id: "auto_drop_head",
          label: "丢弃原视频片头",
          kind: "boolean",
          node: { type: "auto_split", remark: "执行自动拆解" },
          key: "dropHead",
          defaultValue: false,
        },
        {
          id: "auto_drop_tail",
          label: "丢弃原视频片尾",
          kind: "boolean",
          node: { type: "auto_split", remark: "执行自动拆解" },
          key: "dropTail",
          defaultValue: false,
        },
      ],
    },
  ],
  auto_split_concat: [
    {
      key: "dirs",
      title: "1. 目录设置",
      fields: [
        {
          id: "asc_input",
          label: "输入目录",
          kind: "directory",
          node: { type: "input_dir", remark: "原始视频目录" },
          key: "inputDir",
        },
        {
          id: "asc_concat_output",
          label: "输出目录",
          kind: "directory",
          node: { type: "output_dir", remark: "组合输出目录" },
          key: "outputDir",
        },
        {
          id: "asc_split_output",
          label: "拆解临时存储目录",
          kind: "directory",
          node: { type: "output_dir", remark: "拆解片段目录" },
          key: "outputDir",
        },
      ],
    },
    {
      key: "compose",
      title: "2. 自动拆解并拼接设置",
      fields: [
        {
          id: "asc_drop_head",
          label: "自动拆解丢弃片头",
          kind: "boolean",
          node: { type: "auto_split", remark: "按单视频自动拆解" },
          key: "dropHead",
          inlinePair: true,
          defaultValue: false,
        },
        {
          id: "asc_drop_tail",
          label: "自动拆解丢弃片尾",
          kind: "boolean",
          node: { type: "auto_split", remark: "按单视频自动拆解" },
          key: "dropTail",
          inlinePair: true,
          defaultValue: false,
        },
        {
          id: "asc_times",
          label: "最终生成视频数量",
          kind: "number",
          node: { type: "repeat", remark: "循环组合次数" },
          key: "times",
          defaultValue: 1,
          min: 1,
          step: 1,
        },
        {
          id: "asc_random_min",
          label: "重组合使用视频片段数量最小值",
          kind: "number",
          node: { type: "compose_videos", remark: "组合拆解片段" },
          key: "randomCountMin",
          defaultValue: 2,
          min: -1,
          step: 1,
          helpText: "-1 表示使用全部候选视频",
        },
        {
          id: "asc_random_max",
          label: "重组合使用视频片段数量最大值",
          kind: "number",
          node: { type: "compose_videos", remark: "组合拆解片段" },
          key: "randomCountMax",
          defaultValue: 4,
          min: -1,
          step: 1,
          helpText: "-1 表示使用全部候选视频",
        },
        {
          id: "asc_start",
          label: "自定义片头(可选)",
          kind: "video",
          node: { type: "select_video", remark: "可选固定开头" },
          key: "videoPath",
        },
        {
          id: "asc_end",
          label: "自定义片尾(可选)",
          kind: "video",
          node: { type: "select_video", remark: "可选固定结尾" },
          key: "videoPath",
        },
      ],
    },
  ],
  download_auto_split: [
    {
      key: "download_auto_split_simple",
      title: "下载并自动拆解",
      fields: [
        {
          id: "das_text",
          label: "视频链接文本",
          kind: "textarea",
          node: { type: "user_input", remark: "下载文本输入" },
          key: "text",
          rows: 5,
          fullWidth: true,
          placeholder: "每行一个 URL",
        },
        {
          id: "das_output",
          label: "下载输出目录",
          kind: "directory",
          node: { type: "output_dir", remark: "下载输出目录" },
          key: "outputDir",
          fullWidth: true,
        },
        {
          id: "das_split_output",
          label: "拆解输出目录",
          kind: "directory",
          node: { type: "output_dir", remark: "拆解输出目录" },
          key: "outputDir",
          fullWidth: true,
        },
        {
          id: "das_split_concurrency",
          label: "逐个文件拆解并发数",
          kind: "number",
          node: { type: "iterate", remark: "逐个下载文件拆解" },
          key: "concurrency",
          min: 1,
          step: 1,
          defaultValue: 2,
          fullWidth: true,
          helpText: "控制下载完成后，同时拆解几个视频文件",
        },
        {
          id: "das_drop_head",
          label: "丢弃开头片段",
          kind: "boolean",
          node: { type: "auto_split", remark: "下载后自动拆解" },
          key: "dropHead",
          inlinePair: true,
          defaultValue: false,
        },
        {
          id: "das_drop_tail",
          label: "丢弃结尾片段",
          kind: "boolean",
          node: { type: "auto_split", remark: "下载后自动拆解" },
          key: "dropTail",
          inlinePair: true,
          defaultValue: false,
        },
      ],
    },
  ],
  remove_ending: [
    {
      key: "dirs",
      title: "1. 输入与输出",
      fields: [
        {
          id: "re_input",
          label: "待处理视频目录",
          kind: "directory",
          node: { type: "input_dir", remark: "待处理视频目录" },
          key: "inputDir",
        },
        {
          id: "re_output",
          label: "最终视频输出目录",
          kind: "directory",
          node: { type: "output_dir", remark: "去尾输出目录" },
          key: "outputDir",
        },
      ],
    },
    {
      key: "remove_tail",
      title: "2. 去尾参数",
      fields: [
        {
          id: "re_drop_head",
          label: "丢弃原视频片头",
          kind: "boolean",
          node: { type: "split_compose_per_video", remark: "单视频拆解重组" },
          key: "dropHead",
          inlinePair: true,
          defaultValue: false,
        },
        {
          id: "re_drop_tail",
          label: "丢弃原视频片尾",
          kind: "boolean",
          node: { type: "split_compose_per_video", remark: "单视频拆解重组" },
          key: "dropTail",
          inlinePair: true,
          defaultValue: true,
        },
        {
          id: "re_shuffle",
          label: "重组前打乱片段",
          kind: "boolean",
          node: { type: "split_compose_per_video", remark: "单视频拆解重组" },
          key: "shuffle",
          inlinePair: true,
          defaultValue: true,
        },
        {
          id: "re_end_video",
          label: "新视频结尾(可选)",
          kind: "video",
          node: { type: "select_video", remark: "可选替换结尾" },
          key: "videoPath",
          inlinePair: true,
        },
      ],
    },
  ],
  custom: [],
};

function findNodeId(graph: WorkflowGraph, match: NodeMatch): string {
  const typedNodes = graph.nodes.filter((node) => node.type === match.type);
  if (typedNodes.length === 0) {
    return "";
  }

  if (match.remark) {
    const targetRemark = match.remark.trim();
    const foundByRemark = typedNodes.find((node) => String(node.remark || "").trim() === targetRemark);
    if (foundByRemark) {
      return foundByRemark.id;
    }
  }

  const index = Number.isFinite(match.nth) ? Math.max(0, Number(match.nth)) : 0;
  return typedNodes[index]?.id || typedNodes[0]?.id || "";
}

function readNodeConfig(graph: WorkflowGraph, nodeId: string): Record<string, unknown> {
  const node = graph.nodes.find((item) => item.id === nodeId);
  const config = node?.config;
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return {};
  }
  return config as Record<string, unknown>;
}

const resolvedSections = computed<ResolvedSection[]>(() => {
  const sourceSections = SYSTEM_BOARD_SCHEMAS[props.systemKind] || [];
  return sourceSections
    .map((section) => {
      const fields: ResolvedField[] = section.fields
        .map((field) => {
          const nodeId = findNodeId(props.graph, field.node);
          if (!nodeId) {
            return null;
          }
          return {
            ...field,
            nodeId,
          };
        })
        .filter((field): field is ResolvedField => field !== null);

      return {
        key: section.key,
        title: section.title,
        description: section.description,
        fields,
      };
    })
    .filter((section) => section.fields.length > 0);
});

function rawValue(field: ResolvedField): unknown {
  const config = readNodeConfig(props.graph, field.nodeId);
  if (field.derived === "drop_head_tail_mode") {
    const dropHead = config.dropHead === true;
    const dropTail = config.dropTail === true;
    if (dropHead && dropTail) {
      return "both";
    }
    if (dropHead) {
      return "head";
    }
    if (dropTail) {
      return "tail";
    }
    return "none";
  }
  if (field.key in config) {
    return config[field.key];
  }
  return field.defaultValue;
}

function stringValue(field: ResolvedField): string {
  const raw = rawValue(field);
  return typeof raw === "string" ? raw : raw === undefined || raw === null ? "" : String(raw);
}

function numberValue(field: ResolvedField): number | null {
  const raw = rawValue(field);
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return null;
  }
  return value;
}

function booleanValue(field: ResolvedField): boolean {
  const raw = rawValue(field);
  if (typeof raw === "boolean") {
    return raw;
  }
  return Boolean(raw);
}

function selectValue(field: ResolvedField): string {
  const raw = rawValue(field);
  if (typeof raw === "string") {
    return raw;
  }
  return typeof field.defaultValue === "string" ? field.defaultValue : "";
}

function emitUpdate(field: ResolvedField, value: unknown) {
  emit("update-field", {
    nodeId: field.nodeId,
    key: field.key,
    value,
  });
}

function writeString(field: ResolvedField, value: string | number | null) {
  emitUpdate(field, typeof value === "string" ? value : value == null ? "" : String(value));
}

function writeNumber(field: ResolvedField, value: string | number | null) {
  if (value === null || value === "") {
    emitUpdate(field, undefined);
    return;
  }
  const parsed = Number(value);
  emitUpdate(field, Number.isFinite(parsed) ? parsed : undefined);
}

function writeBoolean(field: ResolvedField, value: boolean) {
  emitUpdate(field, Boolean(value));
}

function writeSelect(field: ResolvedField, value: string | null) {
  if (field.derived === "drop_head_tail_mode") {
    const mode = value ?? "none";
    emitUpdate(
      {
        ...field,
        key: "dropHead",
      },
      mode === "head" || mode === "both",
    );
    emitUpdate(
      {
        ...field,
        key: "dropTail",
      },
      mode === "tail" || mode === "both",
    );
    return;
  }
  emitUpdate(field, value ?? "");
}

function pickPath(field: ResolvedField, directory: boolean) {
  emit("pick-path", {
    nodeId: field.nodeId,
    key: field.key,
    directory,
  });
}
</script>

<style scoped>
.system-board {
  min-height: 540px;
}

.system-board-section {
  background: rgba(240, 255, 252, 0.86);
  border-color: rgba(9, 91, 85, 0.15);
  color: #15423f;
}
</style>
