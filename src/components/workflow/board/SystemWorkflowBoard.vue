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
            :class="field.fullWidth === true ? 'col-12' : 'col-12 col-md-6'"
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
  fullWidth?: boolean;
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
          id: "concat_recursive",
          label: "递归扫描子目录",
          kind: "boolean",
          node: { type: "read_mp4_files", remark: "扫描MP4文件" },
          key: "recursive",
          defaultValue: true,
        },
        {
          id: "concat_depth",
          label: "最大扫描深度",
          kind: "number",
          node: { type: "read_mp4_files", remark: "扫描MP4文件" },
          key: "maxDepth",
          defaultValue: 2,
          min: 0,
          step: 1,
        },
        {
          id: "concat_times",
          label: "生成次数",
          kind: "number",
          node: { type: "repeat", remark: "循环生成次数" },
          key: "times",
          defaultValue: 1,
          min: 1,
          step: 1,
        },
        {
          id: "concat_concurrency",
          label: "循环并发数量",
          kind: "number",
          node: { type: "repeat", remark: "循环生成次数" },
          key: "concurrency",
          defaultValue: 1,
          min: 1,
          step: 1,
        },
        {
          id: "concat_shuffle",
          label: "随机打乱顺序",
          kind: "boolean",
          node: { type: "compose_videos", remark: "组合输出视频" },
          key: "shuffle",
          defaultValue: true,
        },
        {
          id: "concat_random_min",
          label: "最少选择视频数",
          kind: "number",
          node: { type: "compose_videos", remark: "组合输出视频" },
          key: "randomCountMin",
          defaultValue: 2,
          min: -1,
          step: 1,
          helpText: "-1 表示使用全部候选视频",
        },
        {
          id: "concat_random_max",
          label: "最多选择视频数",
          kind: "number",
          node: { type: "compose_videos", remark: "组合输出视频" },
          key: "randomCountMax",
          defaultValue: 4,
          min: -1,
          step: 1,
          helpText: "-1 表示使用全部候选视频",
        },
        {
          id: "concat_start",
          label: "固定开头视频(可选)",
          kind: "video",
          node: { type: "select_video", remark: "可选固定开头" },
          key: "videoPath",
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
          label: "待拆解目录",
          kind: "directory",
          node: { type: "input_dir", remark: "待拆解目录" },
          key: "inputDir",
        },
        {
          id: "auto_output",
          label: "拆解输出目录",
          kind: "directory",
          node: { type: "output_dir", remark: "拆解输出目录" },
          key: "outputDir",
        },
      ],
    },
    {
      key: "split",
      title: "2. 拆解参数",
      fields: [
        {
          id: "auto_recursive",
          label: "递归扫描子目录",
          kind: "boolean",
          node: { type: "read_mp4_files", remark: "扫描要拆解的视频" },
          key: "recursive",
          defaultValue: true,
        },
        {
          id: "auto_depth",
          label: "最大扫描深度",
          kind: "number",
          node: { type: "read_mp4_files", remark: "扫描要拆解的视频" },
          key: "maxDepth",
          defaultValue: 2,
          min: 0,
          step: 1,
        },
        {
          id: "auto_concurrency",
          label: "处理并发数量",
          kind: "number",
          node: { type: "iterate", remark: "逐个视频拆解" },
          key: "concurrency",
          defaultValue: 2,
          min: 1,
          step: 1,
        },
        {
          id: "auto_threshold",
          label: "场景切换阈值",
          kind: "number",
          node: { type: "split_algo_ssim", remark: "拆解算法配置" },
          key: "threshold",
          defaultValue: 0.7,
          min: 0,
          max: 1,
          step: 0.01,
        },
        {
          id: "auto_min_duration",
          label: "最短片段时长(秒)",
          kind: "number",
          node: { type: "split_algo_ssim", remark: "拆解算法配置" },
          key: "minDuration",
          defaultValue: 2,
          min: 0.1,
          step: 0.1,
        },
        {
          id: "auto_drop_head",
          label: "丢弃开头片段",
          kind: "boolean",
          node: { type: "auto_split", remark: "执行自动拆解" },
          key: "dropHead",
          defaultValue: false,
        },
        {
          id: "auto_drop_tail",
          label: "丢弃结尾片段",
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
      title: "1. 输入与输出",
      fields: [
        {
          id: "asc_input",
          label: "原始视频目录",
          kind: "directory",
          node: { type: "input_dir", remark: "原始视频目录" },
          key: "inputDir",
        },
        {
          id: "asc_split_output",
          label: "拆解片段目录",
          kind: "directory",
          node: { type: "output_dir", remark: "拆解片段目录" },
          key: "outputDir",
        },
        {
          id: "asc_concat_output",
          label: "组合输出目录",
          kind: "directory",
          node: { type: "output_dir", remark: "组合输出目录" },
          key: "outputDir",
        },
      ],
    },
    {
      key: "split",
      title: "2. 拆解设置",
      fields: [
        {
          id: "asc_threshold",
          label: "场景切换阈值",
          kind: "number",
          node: { type: "split_algo_ssim", remark: "拆解算法配置" },
          key: "threshold",
          defaultValue: 0.7,
          min: 0,
          max: 1,
          step: 0.01,
        },
        {
          id: "asc_min_duration",
          label: "最短片段时长(秒)",
          kind: "number",
          node: { type: "split_algo_ssim", remark: "拆解算法配置" },
          key: "minDuration",
          defaultValue: 2,
          min: 0.1,
          step: 0.1,
        },
        {
          id: "asc_drop_head",
          label: "丢弃开头片段",
          kind: "boolean",
          node: { type: "auto_split", remark: "按单视频自动拆解" },
          key: "dropHead",
          defaultValue: false,
        },
        {
          id: "asc_drop_tail",
          label: "丢弃结尾片段",
          kind: "boolean",
          node: { type: "auto_split", remark: "按单视频自动拆解" },
          key: "dropTail",
          defaultValue: false,
        },
      ],
    },
    {
      key: "compose",
      title: "3. 组合设置",
      fields: [
        {
          id: "asc_times",
          label: "生成次数",
          kind: "number",
          node: { type: "repeat", remark: "循环组合次数" },
          key: "times",
          defaultValue: 1,
          min: 1,
          step: 1,
        },
        {
          id: "asc_concurrency",
          label: "组合并发数量",
          kind: "number",
          node: { type: "repeat", remark: "循环组合次数" },
          key: "concurrency",
          defaultValue: 1,
          min: 1,
          step: 1,
        },
        {
          id: "asc_shuffle",
          label: "组合前打乱顺序",
          kind: "boolean",
          node: { type: "compose_videos", remark: "组合拆解片段" },
          key: "shuffle",
          defaultValue: true,
        },
        {
          id: "asc_random_min",
          label: "最少选择视频数",
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
          label: "最多选择视频数",
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
          label: "固定开头视频(可选)",
          kind: "video",
          node: { type: "select_video", remark: "可选固定开头" },
          key: "videoPath",
        },
        {
          id: "asc_end",
          label: "固定结尾视频(可选)",
          kind: "video",
          node: { type: "select_video", remark: "可选固定结尾" },
          key: "videoPath",
        },
      ],
    },
  ],
  download_auto_split: [
    {
      key: "download_input",
      title: "1. 下载配置",
      fields: [
        {
          id: "das_text",
          label: "视频链接文本",
          kind: "textarea",
          node: { type: "user_input", remark: "下载文本输入" },
          key: "text",
          placeholder: "每行一个 URL",
        },
        ...COMMON_TEXT_SPLIT_FIELDS,
        {
          id: "das_output",
          label: "下载输出目录",
          kind: "directory",
          node: { type: "output_dir", remark: "下载输出目录" },
          key: "outputDir",
        },
        {
          id: "das_download_concurrency",
          label: "下载并发数量",
          kind: "number",
          node: { type: "iterate", remark: "逐条遍历下载项" },
          key: "concurrency",
          defaultValue: 3,
          min: 1,
          step: 1,
        },
      ],
    },
    {
      key: "download_split",
      title: "2. 下载后拆解",
      fields: [
        {
          id: "das_split_output",
          label: "拆解输出目录",
          kind: "directory",
          node: { type: "output_dir", remark: "拆解输出目录" },
          key: "outputDir",
        },
        {
          id: "das_threshold",
          label: "场景切换阈值",
          kind: "number",
          node: { type: "split_algo_ssim", remark: "拆解算法配置" },
          key: "threshold",
          defaultValue: 0.7,
          min: 0,
          max: 1,
          step: 0.01,
        },
        {
          id: "das_min_duration",
          label: "最短片段时长(秒)",
          kind: "number",
          node: { type: "split_algo_ssim", remark: "拆解算法配置" },
          key: "minDuration",
          defaultValue: 2,
          min: 0.1,
          step: 0.1,
        },
        {
          id: "das_drop_head",
          label: "丢弃开头片段",
          kind: "boolean",
          node: { type: "auto_split", remark: "下载后自动拆解" },
          key: "dropHead",
          defaultValue: false,
        },
        {
          id: "das_drop_tail",
          label: "丢弃结尾片段",
          kind: "boolean",
          node: { type: "auto_split", remark: "下载后自动拆解" },
          key: "dropTail",
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
          label: "去尾输出目录",
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
          id: "re_concurrency",
          label: "处理并发数量",
          kind: "number",
          node: { type: "iterate", remark: "逐个视频处理" },
          key: "concurrency",
          defaultValue: 2,
          min: 1,
          step: 1,
        },
        {
          id: "re_threshold",
          label: "场景切换阈值",
          kind: "number",
          node: { type: "split_algo_ssim", remark: "拆解算法配置" },
          key: "threshold",
          defaultValue: 0.7,
          min: 0,
          max: 1,
          step: 0.01,
        },
        {
          id: "re_min_duration",
          label: "最短片段时长(秒)",
          kind: "number",
          node: { type: "split_algo_ssim", remark: "拆解算法配置" },
          key: "minDuration",
          defaultValue: 2,
          min: 0.1,
          step: 0.1,
        },
        {
          id: "re_drop_head",
          label: "丢弃开头片段",
          kind: "boolean",
          node: { type: "split_compose_per_video", remark: "单视频拆解重组" },
          key: "dropHead",
          defaultValue: false,
        },
        {
          id: "re_drop_tail",
          label: "丢弃结尾片段",
          kind: "boolean",
          node: { type: "split_compose_per_video", remark: "单视频拆解重组" },
          key: "dropTail",
          defaultValue: true,
        },
        {
          id: "re_shuffle",
          label: "重组前打乱片段",
          kind: "boolean",
          node: { type: "split_compose_per_video", remark: "单视频拆解重组" },
          key: "shuffle",
          defaultValue: true,
        },
        {
          id: "re_end_video",
          label: "替换结尾视频(可选)",
          kind: "video",
          node: { type: "select_video", remark: "可选替换结尾" },
          key: "videoPath",
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
