<template>
  <div class="comfy-node" :class="`type-${nodeType}`">
    <div class="node-title">
      <span class="node-type">{{ nodeTypeLabel }}</span>
      <span class="node-name">{{ displayLabel }}</span>
    </div>

    <div class="node-body">
      <div class="io-column">
        <div v-for="(inputName, idx) in inputs" :key="`in-${idx}`" class="io-row io-input">
          <Handle :id="`in-${idx}`" type="target" :position="Position.Left" :style="inputHandleStyle(idx, inputs.length)" />
          <span>{{ inputName }}</span>
        </div>
      </div>

      <div class="io-column io-output-col">
        <div v-for="(outputName, idx) in outputs" :key="`out-${idx}`" class="io-row io-output">
          <span>{{ outputName }}</span>
          <Handle :id="`out-${idx}`" type="source" :position="Position.Right" :style="outputHandleStyle(idx, outputs.length)" />
        </div>
      </div>
    </div>

    <div class="node-widgets" @mousedown.stop @click.stop>
      <template v-if="nodeType === 'input_dir'">
        <div class="widget-row">
          <label class="widget-label">输入目录</label>
          <div class="widget-inline">
            <input
              class="widget-input"
              :disabled="isReadonly"
              :value="stringConfig('inputDir')"
              placeholder="/path/to/input"
              @input="onTextInput('inputDir', $event)"
            />
            <button class="widget-btn" :disabled="isReadonly" @click="pickDirectory('inputDir')">选</button>
          </div>
        </div>
      </template>

      <template v-if="nodeType === 'output_dir'">
        <div class="widget-row">
          <label class="widget-label">输出目录</label>
          <div class="widget-inline">
            <input
              class="widget-input"
              :disabled="isReadonly"
              :value="stringConfig('outputDir')"
              placeholder="/path/to/output"
              @input="onTextInput('outputDir', $event)"
            />
            <button class="widget-btn" :disabled="isReadonly" @click="pickDirectory('outputDir')">选</button>
          </div>
        </div>
      </template>

      <template v-if="nodeType === 'select_video'">
        <div class="widget-row">
          <label class="widget-label">视频路径</label>
          <div class="widget-inline">
            <input
              class="widget-input"
              :disabled="isReadonly"
              :value="stringConfig('videoPath')"
              placeholder="/path/to/video.mp4"
              @input="onTextInput('videoPath', $event)"
            />
            <button class="widget-btn" :disabled="isReadonly" @click="pickVideo('videoPath')">选</button>
          </div>
        </div>
        <label class="widget-check">
          <input
            type="checkbox"
            :disabled="isReadonly"
            :checked="boolConfig('required', false)"
            @change="onCheckChange('required', $event)"
          />
          <span>必填(默认可选)</span>
        </label>
      </template>

      <template v-if="nodeType === 'user_input'">
        <div class="widget-row">
          <label class="widget-label">文本输入</label>
          <textarea
            class="widget-textarea"
            :disabled="isReadonly"
            :value="stringConfig('text')"
            placeholder="每行一个 URL"
            @input="onTextAreaInput('text', $event)"
          />
        </div>
      </template>

      <template v-if="nodeType === 'text_split'">
        <div class="widget-row">
          <label class="widget-label">拆分方式</label>
          <select class="widget-select" :disabled="isReadonly" :value="splitMode" @change="onSelectChange('mode', $event)">
            <option value="newline">按换行</option>
            <option value="comma">按逗号</option>
            <option value="space">按空白</option>
            <option value="custom">自定义</option>
          </select>
        </div>
        <div v-if="splitMode === 'custom'" class="widget-row">
          <label class="widget-label">自定义分隔符</label>
          <input
            class="widget-input"
            :disabled="isReadonly"
            :value="stringConfig('customSeparator')"
            placeholder="例如: ||"
            @input="onTextInput('customSeparator', $event)"
          />
        </div>
        <label class="widget-check">
          <input
            type="checkbox"
            :disabled="isReadonly"
            :checked="boolConfig('trim', true)"
            @change="onCheckChange('trim', $event)"
          />
          <span>自动 trim</span>
        </label>
        <label class="widget-check">
          <input
            type="checkbox"
            :disabled="isReadonly"
            :checked="boolConfig('removeEmpty', true)"
            @change="onCheckChange('removeEmpty', $event)"
          />
          <span>移除空项</span>
        </label>
      </template>

      <template v-if="nodeType === 'file'">
        <div class="widget-row">
          <label class="widget-label">动作</label>
          <select class="widget-select" :disabled="isReadonly" :value="stringConfig('action', 'read_mp4')" @change="onSelectChange('action', $event)">
            <option value="read_mp4">读取 MP4</option>
          </select>
        </div>
        <label class="widget-check">
          <input
            type="checkbox"
            :disabled="isReadonly"
            :checked="boolConfig('recursive', true)"
            @change="onCheckChange('recursive', $event)"
          />
          <span>递归读取</span>
        </label>
        <div class="widget-row">
          <label class="widget-label">递归层数</label>
          <input
            class="widget-input"
            type="number"
            min="0"
            step="1"
            :disabled="isReadonly"
            :value="numberConfig('maxDepth', 2)"
            @input="onNumberInput('maxDepth', $event, true)"
          />
        </div>
      </template>

      <template v-if="nodeType === 'network'">
        <div class="widget-row">
          <label class="widget-label">动作</label>
          <select class="widget-select" :disabled="isReadonly" :value="stringConfig('action', 'batch_download')" @change="onSelectChange('action', $event)">
            <option value="batch_download">批量下载</option>
          </select>
        </div>
        <label class="widget-check">
          <input
            type="checkbox"
            :disabled="isReadonly"
            :checked="boolConfig('asyncDownload', true)"
            @change="onCheckChange('asyncDownload', $event)"
          />
          <span>异步并发下载</span>
        </label>
        <div class="widget-row">
          <label class="widget-label">并发数</label>
          <input
            class="widget-input"
            type="number"
            min="1"
            step="1"
            :disabled="isReadonly"
            :value="numberConfig('maxConcurrent', 3)"
            @input="onNumberInput('maxConcurrent', $event, true)"
          />
        </div>
      </template>

      <template v-if="nodeType === 'video'">
        <div class="widget-row">
          <label class="widget-label">动作</label>
          <select class="widget-select" :disabled="isReadonly" :value="videoAction" @change="onSelectChange('action', $event)">
            <option value="split_profile">拆解参数</option>
            <option value="auto_split">自动拆解</option>
            <option value="remove_ending">去结尾</option>
            <option value="concat">拼接(兼容旧流)</option>
            <option value="split_segments">按片段生成</option>
          </select>
        </div>

        <template v-if="videoAction === 'split_profile' || videoAction === 'auto_split' || videoAction === 'remove_ending'">
          <div class="widget-row">
            <label class="widget-label">算法</label>
            <select class="widget-select" :disabled="isReadonly" :value="stringConfig('algorithm', 'ssim')" @change="onSelectChange('algorithm', $event)">
              <option value="ssim">SSIM</option>
              <option value="histogram">直方图</option>
              <option value="frame_diff">帧差异</option>
            </select>
          </div>
          <div class="widget-row">
            <label class="widget-label">阈值</label>
            <input
              class="widget-input"
              type="number"
              min="0"
              max="1"
              step="0.01"
              :disabled="isReadonly"
              :value="numberConfig('threshold', 0.7)"
              @input="onNumberInput('threshold', $event)"
            />
          </div>
          <div class="widget-row">
            <label class="widget-label">最小时长</label>
            <input
              class="widget-input"
              type="number"
              min="0"
              step="0.1"
              :disabled="isReadonly"
              :value="numberConfig('minDuration', 2)"
              @input="onNumberInput('minDuration', $event)"
            />
          </div>
          <label class="widget-check">
            <input
              type="checkbox"
              :disabled="isReadonly"
              :checked="boolConfig('skipFirst', false)"
              @change="onCheckChange('skipFirst', $event)"
            />
            <span>跳过首片段</span>
          </label>
          <label class="widget-check">
            <input
              type="checkbox"
              :disabled="isReadonly"
              :checked="boolConfig('skipLast', true)"
              @change="onCheckChange('skipLast', $event)"
            />
            <span>跳过最后片段</span>
          </label>
        </template>

        <template v-if="videoAction === 'remove_ending'">
          <label class="widget-check">
            <input
              type="checkbox"
              :disabled="isReadonly"
              :checked="boolConfig('shuffleSegments', false)"
              @change="onCheckChange('shuffleSegments', $event)"
            />
            <span>随机打乱片段</span>
          </label>
          <div class="widget-row">
            <label class="widget-label">新结尾视频(可选)</label>
            <div class="widget-inline">
              <input
                class="widget-input"
                :disabled="isReadonly"
                :value="stringConfig('newEndingVideo')"
                placeholder="/path/to/ending.mp4"
                @input="onTextInput('newEndingVideo', $event)"
              />
              <button class="widget-btn" :disabled="isReadonly" @click="pickVideo('newEndingVideo')">选</button>
            </div>
          </div>
        </template>

        <template v-if="videoAction === 'concat'">
          <div class="widget-row">
            <label class="widget-label">随机最小数量</label>
            <input
              class="widget-input"
              type="number"
              min="1"
              step="1"
              :disabled="isReadonly"
              :value="numberConfig('randomCountMin', 2)"
              @input="onNumberInput('randomCountMin', $event, true)"
            />
          </div>
          <div class="widget-row">
            <label class="widget-label">随机最大数量</label>
            <input
              class="widget-input"
              type="number"
              min="1"
              step="1"
              :disabled="isReadonly"
              :value="numberConfig('randomCountMax', 4)"
              @input="onNumberInput('randomCountMax', $event, true)"
            />
          </div>
          <div class="widget-row">
            <label class="widget-label">生成次数</label>
            <input
              class="widget-input"
              type="number"
              min="1"
              step="1"
              :disabled="isReadonly"
              :value="numberConfig('runTimes', 1)"
              @input="onNumberInput('runTimes', $event, true)"
            />
          </div>
          <div class="widget-row">
            <label class="widget-label">固定开头(可选)</label>
            <div class="widget-inline">
              <input
                class="widget-input"
                :disabled="isReadonly"
                :value="stringConfig('startingVideo')"
                placeholder="/path/to/start.mp4"
                @input="onTextInput('startingVideo', $event)"
              />
              <button class="widget-btn" :disabled="isReadonly" @click="pickVideo('startingVideo')">选</button>
            </div>
          </div>
          <div class="widget-row">
            <label class="widget-label">固定结尾(可选)</label>
            <div class="widget-inline">
              <input
                class="widget-input"
                :disabled="isReadonly"
                :value="stringConfig('endingVideo')"
                placeholder="/path/to/end.mp4"
                @input="onTextInput('endingVideo', $event)"
              />
              <button class="widget-btn" :disabled="isReadonly" @click="pickVideo('endingVideo')">选</button>
            </div>
          </div>
        </template>
      </template>

      <template v-if="nodeType === 'random_concat'">
        <div class="widget-row">
          <label class="widget-label">随机最小数量</label>
          <input
            class="widget-input"
            type="number"
            min="1"
            step="1"
            :disabled="isReadonly"
            :value="numberConfig('randomCountMin', 2)"
            @input="onNumberInput('randomCountMin', $event, true)"
          />
        </div>
        <div class="widget-row">
          <label class="widget-label">随机最大数量</label>
          <input
            class="widget-input"
            type="number"
            min="1"
            step="1"
            :disabled="isReadonly"
            :value="numberConfig('randomCountMax', 4)"
            @input="onNumberInput('randomCountMax', $event, true)"
          />
        </div>
        <div class="widget-row">
          <label class="widget-label">生成次数</label>
          <input
            class="widget-input"
            type="number"
            min="1"
            step="1"
            :disabled="isReadonly"
            :value="numberConfig('runTimes', 1)"
            @input="onNumberInput('runTimes', $event, true)"
          />
        </div>
      </template>

      <template v-if="nodeType === 'remove_ending'">
        <label class="widget-check">
          <input
            type="checkbox"
            :disabled="isReadonly"
            :checked="boolConfig('shuffleSegments', false)"
            @change="onCheckChange('shuffleSegments', $event)"
          />
          <span>随机打乱片段</span>
        </label>
        <div class="widget-row">
          <label class="widget-label">新结尾视频(可选)</label>
          <div class="widget-inline">
            <input
              class="widget-input"
              :disabled="isReadonly"
              :value="stringConfig('newEndingVideo')"
              placeholder="/path/to/ending.mp4"
              @input="onTextInput('newEndingVideo', $event)"
            />
            <button class="widget-btn" :disabled="isReadonly" @click="pickVideo('newEndingVideo')">选</button>
          </div>
        </div>
      </template>
    </div>

    <div v-if="configPreview" class="node-config">{{ configPreview }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { Handle, Position } from "@vue-flow/core";

interface NodeData {
  label?: string;
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

const displayLabel = computed(() => props.data?.label || "未命名节点");
const nodeType = computed(() => props.data?.nodeType || "custom");
const nodeTypeLabel = computed(() => props.data?.nodeTypeLabel || "自定义");
const isReadonly = computed(() => props.data?.readonly === true);
const inputs = computed(() => (Array.isArray(props.data?.inputs) ? props.data.inputs : ["in"]));
const outputs = computed(() => (Array.isArray(props.data?.outputs) ? props.data.outputs : ["out"]));
const config = computed(() => props.data?.config || {});
const splitMode = computed(() => stringConfig("mode", "newline"));
const videoAction = computed(() => stringConfig("action", "split_profile"));

function updateConfig(key: string, value: unknown) {
  props.data?.onConfigChange?.(key, value);
}

function pickDirectory(target: "inputDir" | "outputDir") {
  props.data?.onPickDirectory?.(target);
}

function pickVideo(configKey: string) {
  props.data?.onPickVideo?.(configKey);
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

function onNumberInput(key: string, event: Event, integer = false) {
  const raw = (event.target as HTMLInputElement).value;
  const number = Number(raw);
  if (!Number.isFinite(number)) {
    updateConfig(key, undefined);
    return;
  }
  updateConfig(key, integer ? Math.max(0, Math.round(number)) : number);
}

function handleStyle(topPercent: number): Record<string, string> {
  return {
    width: "10px",
    height: "10px",
    border: "1px solid #111827",
    background: "#f59e0b",
    top: `${topPercent}%`,
  };
}

function inputHandleStyle(index: number, total: number): Record<string, string> {
  const topPercent = ((index + 1) / (Math.max(total, 1) + 1)) * 100;
  return handleStyle(topPercent);
}

function outputHandleStyle(index: number, total: number): Record<string, string> {
  const topPercent = ((index + 1) / (Math.max(total, 1) + 1)) * 100;
  return handleStyle(topPercent);
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
  min-width: 260px;
  max-width: 360px;
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
  gap: 8px;
  background: linear-gradient(90deg, #111827 0%, #1f2937 70%);
  border-radius: 10px 10px 0 0;
}

.node-type {
  font-size: 11px;
  line-height: 1;
  padding: 3px 6px;
  border-radius: 999px;
  background: rgba(245, 158, 11, 0.2);
  border: 1px solid rgba(245, 158, 11, 0.5);
  color: #fbbf24;
}

.node-name {
  font-weight: 600;
  font-size: 13px;
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
  margin-bottom: 6px;
}

.widget-label {
  display: block;
  margin-bottom: 3px;
  font-size: 11px;
  color: #9ca3af;
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
  margin-bottom: 4px;
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

.type-control .node-type {
  color: #93c5fd;
  border-color: rgba(96, 165, 250, 0.65);
  background: rgba(59, 130, 246, 0.2);
}

.type-video .node-type {
  color: #86efac;
  border-color: rgba(74, 222, 128, 0.5);
  background: rgba(34, 197, 94, 0.18);
}

.type-input_dir .node-type {
  color: #c4b5fd;
  border-color: rgba(167, 139, 250, 0.6);
  background: rgba(139, 92, 246, 0.2);
}

.type-output_dir .node-type {
  color: #fde68a;
  border-color: rgba(251, 191, 36, 0.6);
  background: rgba(217, 119, 6, 0.18);
}

.type-user_input .node-type {
  color: #67e8f9;
  border-color: rgba(34, 211, 238, 0.6);
  background: rgba(8, 145, 178, 0.18);
}

.type-text_split .node-type {
  color: #f0abfc;
  border-color: rgba(232, 121, 249, 0.6);
  background: rgba(168, 85, 247, 0.18);
}

.type-select_video .node-type {
  color: #fca5a5;
  border-color: rgba(248, 113, 113, 0.6);
  background: rgba(220, 38, 38, 0.18);
}

.type-random_concat .node-type {
  color: #67e8f9;
  border-color: rgba(34, 211, 238, 0.6);
  background: rgba(8, 145, 178, 0.2);
}

.type-remove_ending .node-type {
  color: #fdba74;
  border-color: rgba(251, 146, 60, 0.6);
  background: rgba(234, 88, 12, 0.2);
}
</style>
