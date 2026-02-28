<template>
  <div class="comfy-node" :class="`type-${nodeType}`">
    <div class="node-title">
      <span v-if="hasRemark" class="node-name">
        {{ nodeRemark }}
        <span class="node-name-origin">({{ nodeTypeLabel }})</span>
      </span>
      <span v-else class="node-name">{{ nodeTypeLabel }}</span>
    </div>

    <div class="node-body">
      <div class="io-column">
        <div v-for="(inputName, idx) in inputs" :key="`in-${idx}`" class="io-row io-input">
          <Handle
            :id="`in-${idx}`"
            type="target"
            :position="Position.Left"
            :style="inputHandleStyle(idx, inputs.length, inputName)"
          />
          <span :title="portTooltip('input', inputName)">{{ portLabel('input', inputName) }}</span>
        </div>
      </div>

      <div class="io-column io-output-col">
        <div v-for="(outputName, idx) in outputs" :key="`out-${idx}`" class="io-row io-output">
          <span :title="portTooltip('output', outputName)">{{ portLabel('output', outputName) }}</span>
          <Handle
            :id="`out-${idx}`"
            type="source"
            :position="Position.Right"
            :style="outputHandleStyle(idx, outputs.length, outputName)"
          />
        </div>
      </div>
    </div>

    <div class="node-widgets" @mousedown.stop @click.stop>
      <div v-for="field in visibleFields" :key="field.key" class="widget-row">
        <label class="widget-label">{{ field.label }}</label>

        <div v-if="field.type === 'directory' || field.type === 'video'" class="widget-inline">
          <input
            class="widget-input"
            :disabled="isReadonly"
            :value="stringConfig(field.key)"
            :placeholder="field.placeholder"
            @input="onTextInput(field.key, $event)"
          />
          <button
            class="widget-btn"
            :disabled="isReadonly"
            @click="pickPath(field.key, field.type)"
          >选</button>
        </div>

        <textarea
          v-else-if="field.type === 'textarea' || field.type === 'json'"
          class="widget-textarea"
          :disabled="isReadonly"
          :value="stringConfig(field.key)"
          :placeholder="field.placeholder"
          @input="onTextAreaInput(field.key, $event)"
        />

        <select
          v-else-if="field.type === 'select'"
          class="widget-select"
          :disabled="isReadonly"
          :value="stringConfig(field.key, String(field.defaultValue ?? ''))"
          @change="onSelectChange(field.key, $event)"
        >
          <option v-for="option in field.options || []" :key="`${field.key}-${option.value}`" :value="option.value">
            {{ option.label }}
          </option>
        </select>

        <label v-else-if="field.type === 'boolean'" class="widget-check">
          <input
            type="checkbox"
            :disabled="isReadonly"
            :checked="boolConfig(field.key, Boolean(field.defaultValue ?? false))"
            @change="onCheckChange(field.key, $event)"
          />
          <span>{{ field.helpText || '启用' }}</span>
        </label>

        <input
          v-else-if="field.type === 'number'"
          class="widget-input"
          type="number"
          :min="field.min"
          :max="field.max"
          :step="field.step || 1"
          :disabled="isReadonly"
          :value="numberConfig(field.key, Number(field.defaultValue ?? 0))"
          @input="onNumberInput(field.key, $event)"
        />

        <input
          v-else
          class="widget-input"
          :disabled="isReadonly"
          :value="stringConfig(field.key)"
          :placeholder="field.placeholder"
          @input="onTextInput(field.key, $event)"
        />

        <div v-if="field.helpText && field.type !== 'boolean'" class="widget-help">{{ field.helpText }}</div>
      </div>
    </div>

    <div v-if="configPreview" class="node-config">{{ configPreview }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { Handle, Position } from "@vue-flow/core";
import { getNodeDefinition } from "src/shared/nodes";
import type { NodeFieldDefinition } from "src/shared/nodes";
import { PORT_VALUE_TYPES, WORKFLOW_NODE_MACRO_MAP, formatPortTypeText } from "src/shared/workflow-node-macros";

interface NodeData {
  remark?: string;
  nodeType?: string;
  nodeTypeLabel?: string;
  inputs?: string[];
  outputs?: string[];
  config?: Record<string, unknown>;
  readonly?: boolean;
  onConfigChange?: (key: string, value: unknown) => void;
  onPickDirectory?: (target: "inputDir" | "outputDir") => void;
  onPickVideo?: (configKey: string) => void;
}

const props = defineProps<{
  data?: NodeData;
}>();

const nodeType = computed(() => props.data?.nodeType || "custom");
const definition = computed(() => getNodeDefinition(nodeType.value));
const nodeTypeLabel = computed(() => props.data?.nodeTypeLabel || definition.value?.name || "自定义");
const nodeRemark = computed(() => {
  const raw = props.data?.remark;
  return typeof raw === "string" ? raw.trim() : "";
});
const hasRemark = computed(() => nodeRemark.value.length > 0);
const isReadonly = computed(() => props.data?.readonly === true);
const inputs = computed(() => (Array.isArray(props.data?.inputs) ? props.data.inputs : ["in"]));
const outputs = computed(() => (Array.isArray(props.data?.outputs) ? props.data.outputs : ["out"]));
const config = computed(() => props.data?.config || {});

const visibleFields = computed<NodeFieldDefinition[]>(() => {
  const fields = definition.value?.fields || [];
  return fields.filter((field) => (field.showWhen ? field.showWhen(config.value) : true));
});

function updateConfig(key: string, value: unknown) {
  props.data?.onConfigChange?.(key, value);
}

function pickPath(configKey: string, fieldType: "directory" | "video") {
  if (fieldType === "video") {
    props.data?.onPickVideo?.(configKey);
    return;
  }
  const target = configKey === "outputDir" ? "outputDir" : "inputDir";
  props.data?.onPickDirectory?.(target);
}

function stringConfig(key: string, fallback = ""): string {
  const value = config.value[key];
  return typeof value === "string" ? value : fallback;
}

function numberConfig(key: string, fallback: number): number {
  const value = Number(config.value[key]);
  return Number.isFinite(value) ? value : fallback;
}

function boolConfig(key: string, fallback: boolean): boolean {
  const value = config.value[key];
  return typeof value === "boolean" ? value : fallback;
}

function onTextInput(key: string, event: Event) {
  updateConfig(key, (event.target as HTMLInputElement).value);
}

function onTextAreaInput(key: string, event: Event) {
  updateConfig(key, (event.target as HTMLTextAreaElement).value);
}

function onSelectChange(key: string, event: Event) {
  updateConfig(key, (event.target as HTMLSelectElement).value);
}

function onCheckChange(key: string, event: Event) {
  updateConfig(key, (event.target as HTMLInputElement).checked);
}

function onNumberInput(key: string, event: Event) {
  const raw = (event.target as HTMLInputElement).value;
  const number = Number(raw);
  if (!Number.isFinite(number)) {
    updateConfig(key, undefined);
    return;
  }
  updateConfig(key, number);
}

function portColorByValueType(valueType: string, multiple = false): string {
  switch (valueType) {
    case PORT_VALUE_TYPES.ABSOLUTE_PATH:
      return multiple ? "#fb7185" : "#ef4444";
    case PORT_VALUE_TYPES.PLAIN_TEXT:
      return multiple ? "#10b981" : "#22c55e";
    case PORT_VALUE_TYPES.COUNT:
      return "#f59e0b";
    case PORT_VALUE_TYPES.COMPLETION_SIGNAL:
      return "#38bdf8";
    case PORT_VALUE_TYPES.RESULT_SUMMARY:
      return "#f97316";
    case PORT_VALUE_TYPES.JSON_OBJECT:
      return "#6366f1";
    case PORT_VALUE_TYPES.VIDEO_SPLIT_ALGORITHM:
      return "#a78bfa";
    default:
      return "#94a3b8";
  }
}

function resolvePortMeta(direction: "input" | "output", portName: string): {
  name: string;
  label: string;
  valueType: string;
  multiple: boolean;
  typeText: string;
  description: string;
} {
  const macro = WORKFLOW_NODE_MACRO_MAP[nodeType.value];
  if (!macro) {
    return {
      name: portName,
      label: portName,
      valueType: PORT_VALUE_TYPES.ANY_PAYLOAD,
      multiple: false,
      typeText: formatPortTypeText(PORT_VALUE_TYPES.ANY_PAYLOAD, false),
      description: "该端点用于传递数据。",
    };
  }
  const ports = direction === "input" ? macro.inputs : macro.outputs;
  const found = ports.find((port) => port.name === portName);
  if (!found) {
    return {
      name: portName,
      label: portName,
      valueType: PORT_VALUE_TYPES.ANY_PAYLOAD,
      multiple: false,
      typeText: formatPortTypeText(PORT_VALUE_TYPES.ANY_PAYLOAD, false),
      description: "该端点用于传递数据。",
    };
  }
  return {
    ...found,
    typeText: found.typeText || formatPortTypeText(found.valueType, found.multiple === true),
  };
}

function portLabel(direction: "input" | "output", portName: string): string {
  return resolvePortMeta(direction, portName).label;
}

function portTooltip(direction: "input" | "output", portName: string): string {
  const meta = resolvePortMeta(direction, portName);
  return `${meta.label} (${meta.name})\n类型: ${meta.typeText}\n${meta.description}`;
}

function handleStyle(topPercent: number, color: string): Record<string, string> {
  return {
    width: "10px",
    height: "10px",
    border: "1px solid #111827",
    background: color,
    top: `${topPercent}%`,
  };
}

function inputHandleStyle(index: number, total: number, portName: string): Record<string, string> {
  const topPercent = ((index + 1) / (Math.max(total, 1) + 1)) * 100;
  const meta = resolvePortMeta("input", portName);
  return handleStyle(topPercent, portColorByValueType(meta.valueType, meta.multiple));
}

function outputHandleStyle(index: number, total: number, portName: string): Record<string, string> {
  const topPercent = ((index + 1) / (Math.max(total, 1) + 1)) * 100;
  const meta = resolvePortMeta("output", portName);
  return handleStyle(topPercent, portColorByValueType(meta.valueType, meta.multiple));
}

const configPreview = computed(() => {
  const entries = Object.entries(config.value || {}).slice(0, 3);
  if (entries.length === 0) {
    return "";
  }
  return entries.map(([key, value]) => `${key}: ${String(value)}`).join(" | ");
});
</script>

<style scoped>
.comfy-node {
  min-width: 280px;
  max-width: 380px;
  border: 1px solid #111827;
  border-radius: 10px;
  background: #1f2937;
  color: #e5e7eb;
  box-shadow: 0 10px 18px rgba(0, 0, 0, 0.35);
}

.node-title {
  padding: 8px 10px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.28);
  display: flex;
  align-items: center;
  background: linear-gradient(90deg, #111827 0%, #1f2937 70%);
  border-radius: 10px 10px 0 0;
}

.node-subtitle {
  padding: 4px 10px;
  font-size: 11px;
  color: #9ca3af;
  border-bottom: 1px solid rgba(148, 163, 184, 0.2);
}

.node-name {
  font-weight: 700;
  font-size: 14px;
  color: #f3f4f6;
}

.node-name-origin {
  margin-left: 4px;
  font-size: 10px;
  font-weight: 500;
  color: #94a3b8;
}

.node-body {
  display: flex;
  gap: 8px;
  padding: 8px 6px;
}

.io-column {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.io-output-col {
  text-align: right;
}

.io-row {
  position: relative;
  min-height: 18px;
  font-size: 12px;
  color: #d1d5db;
  padding: 0 8px;
  display: flex;
  align-items: center;
}

.io-input {
  justify-content: flex-start;
}

.io-output {
  justify-content: flex-end;
}

.node-widgets {
  margin: 0 8px 8px;
  padding: 8px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 8px;
  background: rgba(17, 24, 39, 0.45);
}

.widget-row {
  margin-bottom: 8px;
}

.widget-label {
  display: block;
  margin-bottom: 3px;
  font-size: 11px;
  color: #9ca3af;
}

.widget-help {
  margin-top: 4px;
  font-size: 11px;
  color: #94a3b8;
}

.widget-inline {
  display: flex;
  gap: 6px;
}

.widget-input,
.widget-select,
.widget-textarea {
  width: 100%;
  border: 1px solid rgba(148, 163, 184, 0.45);
  border-radius: 6px;
  background: #0f172a;
  color: #e5e7eb;
  padding: 4px 6px;
  font-size: 12px;
}

.widget-textarea {
  min-height: 62px;
  resize: vertical;
}

.widget-btn {
  min-width: 28px;
  border: 1px solid rgba(148, 163, 184, 0.45);
  border-radius: 6px;
  background: #1e293b;
  color: #e5e7eb;
  font-size: 12px;
}

.widget-check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #cbd5e1;
}

.node-config {
  padding: 0 10px 9px;
  font-size: 11px;
  color: #94a3b8;
  border-top: 1px dashed rgba(148, 163, 184, 0.28);
  margin-top: 2px;
  padding-top: 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
