<template>
  <div class="video-splitter">
    <!-- 视频信息卡片 -->
    <div v-if="videoMetadata" class="info-card">
      <h3>{{ title || '视频信息' }}</h3>
      <div class="info-grid">
        <div class="info-item">
          <span class="info-label">分辨率:</span>
          <span>{{ videoMetadata.width }}x{{ videoMetadata.height }}</span>
        </div>
        <div class="info-item">
          <span class="info-label">帧率:</span>
          <span>{{ videoMetadata.fps.toFixed(2) }} fps</span>
        </div>
        <div class="info-item">
          <span class="info-label">时长:</span>
          <span>{{ videoMetadata.duration.toFixed(2) }} 秒</span>
        </div>
        <div class="info-item">
          <span class="info-label">总帧数:</span>
          <span>{{ videoMetadata.total_frames }}</span>
        </div>
      </div>
    </div>

    <!-- 加载状态 -->
    <div v-if="isLoadingFrames" class="progress-box">
      {{ frameProgressMsg }}
      <div class="progress-bar">
        <div class="progress-fill" :style="{ width: frameProgress + '%' }"></div>
      </div>
      <div class="progress-percent">{{ frameProgress }}%</div>
    </div>

    <!-- 帧选择区域 -->
    <div v-if="allFrames.length > 0" class="frames-section">
      <h3>视频帧（点击选择起始和结束帧）</h3>
      <div ref="framesGridRef" class="frames-grid">
        <template v-for="frame in allFrames" :key="frame.frame_number">
          <!-- 如果是片段的第一帧，显示占位符 -->
          <div v-if="isSegmentStart(frame.frame_number)" class="frame-placeholder">
            <div class="placeholder-icon">📁</div>
            <div class="placeholder-text">
              帧 {{ getSegmentRange(frame.frame_number) }}<br>已添加到片段
            </div>
          </div>
          <!-- 如果帧在片段中但不是第一帧，跳过不显示 -->
          <template v-else-if="isFrameInSegment(frame.frame_number)">
            <!-- 不渲染任何内容 -->
          </template>
          <!-- 否则显示正常的帧 -->
          <div
            v-else
            class="frame-item"
            :class="{
              'frame-selected': currentSelection && frame.frame_number >= currentSelection.start && frame.frame_number <= currentSelection.end
            }"
            @click="selectFrame(frame.frame_number)"
          >
            <img :src="convertAssetPath(frame.image_path)" :alt="`帧 ${frame.frame_number}`" />
            <div class="frame-info">
              <div>帧 {{ frame.frame_number }}</div>
              <div>{{ frame.timestamp.toFixed(2) }}s</div>
            </div>
          </div>
        </template>
      </div>

      <div v-if="currentSelection" class="selection-info">
        当前选择: 帧 {{ currentSelection.start }} - {{ currentSelection.end }}
        ({{ (currentSelection.start / videoMetadata!.fps).toFixed(2) }}s - {{ (currentSelection.end / videoMetadata!.fps).toFixed(2) }}s)
        <button @click="addSegment" class="btn-add">添加到片段列表</button>
        <button @click="currentSelection = null" class="btn-cancel">取消选择</button>
      </div>
    </div>

    <!-- 已选片段列表 -->
    <div v-if="selectedSegments.length > 0" class="segments-section">
      <h3>已选片段</h3>
      <div class="segments-list">
        <div v-for="(segment, index) in selectedSegments" :key="index" class="segment-item">
          <span>片段 {{ index + 1 }}: 帧 {{ segment.start_frame }} - {{ segment.end_frame }}</span>
          <span class="segment-time">
            ({{ (segment.start_frame / videoMetadata!.fps).toFixed(2) }}s - {{ (segment.end_frame / videoMetadata!.fps).toFixed(2) }}s)
          </span>
          <button @click="removeSegment(index)" class="btn-remove">删除</button>
        </div>
      </div>
    </div>

    <!-- 生成按钮 -->
    <button
      v-if="selectedSegments.length > 0 && !hideGenerateButton"
      class="start-btn"
      @click="handleGenerate"
      :disabled="isGeneratingSegments"
    >
      {{ isGeneratingSegments ? "生成中..." : "开始生成" }}
    </button>

    <div v-if="isGeneratingSegments" class="progress-box">
      {{ progressMsg }}
      <div class="progress-bar">
        <div class="progress-fill" :style="{ width: segmentProgress + '%' }"></div>
      </div>
      <div class="progress-percent">{{ segmentProgress }}%</div>
    </div>

    <div v-if="error" class="error-box">
      {{ error }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { convertFileSrc } from "@tauri-apps/api/core";

interface VideoMetadata {
  width: number;
  height: number;
  fps: number;
  duration: number;
  total_frames: number;
  codec: string;
}

interface FrameInfo {
  frame_number: number;
  timestamp: number;
  image_path: string;
}

interface SegmentRange {
  start_frame: number;
  end_frame: number;
}

interface Props {
  videoMetadata: VideoMetadata | null;
  allFrames: FrameInfo[];
  isLoadingFrames?: boolean;
  frameProgress?: number;
  frameProgressMsg?: string;
  isGeneratingSegments?: boolean;
  segmentProgress?: number;
  progressMsg?: string;
  error?: string;
  title?: string;
  hideGenerateButton?: boolean;
}

withDefaults(defineProps<Props>(), {
  isLoadingFrames: false,
  frameProgress: 0,
  frameProgressMsg: "",
  isGeneratingSegments: false,
  segmentProgress: 0,
  progressMsg: "",
  error: "",
  hideGenerateButton: false,
});

const emit = defineEmits<{
  generate: [segments: SegmentRange[]];
  segmentsChange: [segments: SegmentRange[]];
}>();

const selectedSegments = ref<SegmentRange[]>([]);
const currentSelection = ref<{ start: number; end: number } | null>(null);
const framesGridRef = ref<HTMLElement | null>(null);

// 转换资源路径
function convertAssetPath(path: string): string {
  return convertFileSrc(path);
}

// 选择帧
function selectFrame(frameNumber: number) {
  if (!currentSelection.value) {
    currentSelection.value = { start: frameNumber, end: frameNumber };
  } else {
    if (frameNumber < currentSelection.value.start) {
      currentSelection.value.start = frameNumber;
    } else {
      currentSelection.value.end = frameNumber;
    }
  }
}

// 添加片段
function addSegment() {
  if (!currentSelection.value) return;

  const { start, end } = currentSelection.value;
  if (start >= end) {
    return;
  }

  selectedSegments.value.push({ start_frame: start, end_frame: end });
  currentSelection.value = null;
  emit('segmentsChange', selectedSegments.value);

  // 滚动到顶部
  if (framesGridRef.value) {
    framesGridRef.value.scrollTop = 0;
  }
}

// 删除片段
function removeSegment(index: number) {
  selectedSegments.value.splice(index, 1);
  emit('segmentsChange', selectedSegments.value);
}

// 生成视频片段
function handleGenerate() {
  emit('generate', selectedSegments.value);
}

// 判断帧是否在已选片段中
function isFrameInSegment(frameNumber: number): boolean {
  return selectedSegments.value.some(
    segment => frameNumber >= segment.start_frame && frameNumber <= segment.end_frame
  );
}

// 判断帧是否是片段的起始帧
function isSegmentStart(frameNumber: number): boolean {
  return selectedSegments.value.some(
    segment => frameNumber === segment.start_frame
  );
}

// 获取帧所在片段的范围（用于显示）
function getSegmentRange(frameNumber: number): string {
  const segment = selectedSegments.value.find(
    seg => frameNumber >= seg.start_frame && frameNumber <= seg.end_frame
  );
  if (segment) {
    return `${segment.start_frame}-${segment.end_frame}`;
  }
  return '';
}

// 重置片段（供外部调用）
function resetSegments() {
  selectedSegments.value = [];
  currentSelection.value = null;
}

// 暴露方法给父组件
defineExpose({
  resetSegments,
  selectedSegments,
});
</script>

<style scoped>
.video-splitter {
  display: flex;
  flex-direction: column;
  height: calc(100% - 120px);
    color: white;
}

.info-card {
  background-color: #f5f5f5;
  border-radius: 8px;
  padding: 15px;
  margin-bottom: 20px;
  flex-shrink: 0;
}

.info-card h3 {
  margin-top: 0;
  margin-bottom: 12px;
  font-size: 16px;
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}

.info-item {
  display: flex;
  gap: 8px;
  font-size: 14px;
}

.info-label {
  font-weight: 500;
  color: #555;
}

.frames-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  margin-bottom: 20px;
}

.frames-section h3 {
  font-size: 16px;
  margin-bottom: 12px;
  flex-shrink: 0;
}

.frames-grid {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  gap: 8px;
  padding: 10px;
  border: 1px solid #ddd;
  border-radius: 8px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.frame-item {
  cursor: pointer;
  border: 2px solid #ddd;
  border-radius: 6px;
  overflow: hidden;
  transition: all 0.2s;
  display: flex;
  flex-direction: column;
  background-color: white;
  height: 120px;
}

.frame-item:hover {
  border-color: #396cd8;
  transform: scale(1.05);
}

.frame-item.frame-selected {
  border-width: 4px;
  border-color: #4caf50;
  background-color: #c8e6c9;
  box-shadow: 0 0 10px rgba(76, 175, 80, 0.5);
}

.frame-item img {
  width: 100%;
  flex: 1;
  display: block;
  object-fit: fill;
  min-height: 0;
}

.frame-info {
  padding: 4px;
  background-color: #f5f5f5;
  font-size: 10px;
  text-align: center;
  flex-shrink: 0;
  line-height: 1.2;
}

.frame-placeholder {
  border: 2px dashed #9e9e9e;
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 10px;
  background-color: #f5f5f5;
  min-height: 100px;
}

.placeholder-icon {
  font-size: 24px;
  margin-bottom: 5px;
}

.placeholder-text {
  font-size: 10px;
  text-align: center;
  color: #555;
  line-height: 1.3;
}

.selection-info {
  background-color: #e7f3ff;
  border: 1px solid #2196f3;
  border-radius: 8px;
  padding: 12px;
  margin-top: 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  flex-shrink: 0;
}

.segments-section {
  margin-bottom: 20px;
  flex-shrink: 0;
}

.segments-section h3 {
  font-size: 16px;
  margin-bottom: 12px;
}

.segments-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.segment-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px;
  background-color: #f5f5f5;
  border-radius: 6px;
  gap: 10px;
}

.segment-time {
  color: #555;
  font-size: 13px;
}

.btn-add,
.btn-cancel,
.btn-remove {
  padding: 6px 12px;
  font-size: 13px;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-add {
  background-color: #4caf50;
  color: white;
}

.btn-add:hover {
  background-color: #45a049;
}

.btn-cancel {
  background-color: #9e9e9e;
  color: white;
}

.btn-cancel:hover {
  background-color: #757575;
}

.btn-remove {
  background-color: #f44336;
  color: white;
  padding: 4px 10px;
  font-size: 12px;
}

.btn-remove:hover {
  background-color: #d32f2f;
}

.start-btn {
  padding: 12px 24px;
  font-size: 16px;
  font-weight: 500;
  border: none;
  border-radius: 8px;
  background-color: #396cd8;
  color: white;
  cursor: pointer;
  transition: all 0.2s;
  margin-bottom: 20px;
  flex-shrink: 0;
}

.start-btn:hover:not(:disabled) {
  background-color: #2c5ab8;
}

.start-btn:disabled {
  background-color: #ccc;
  cursor: not-allowed;
}

.progress-box {
  background-color: #e7f3ff;
  border: 1px solid #2196f3;
  border-radius: 8px;
  padding: 15px;
  margin-bottom: 20px;
  flex-shrink: 0;
}

.progress-bar {
  width: 100%;
  height: 20px;
  background-color: #e0e0e0;
  border-radius: 10px;
  overflow: hidden;
  margin-top: 10px;
}

.progress-fill {
  height: 100%;
  background-color: #2196f3;
  transition: width 0.3s;
}

.progress-percent {
  text-align: center;
  margin-top: 5px;
  font-weight: 500;
}

.error-box {
  background-color: #ffebee;
  border: 1px solid #f44336;
  border-radius: 8px;
  padding: 15px;
  color: #c62828;
  margin-bottom: 20px;
  flex-shrink: 0;
}

@media (prefers-color-scheme: dark) {
  .info-card {
    background-color: #2f2f2f;
  }

  .info-label {
    color: #ccc;
  }

  .frame-item {
    border-color: #555;
    background-color: #2f2f2f;
  }

  .frame-item:hover {
    border-color: #64b5f6;
  }

  .frame-item.frame-selected {
    border-color: #66bb6a;
    background-color: #2e5e3e;
    box-shadow: 0 0 10px rgba(102, 187, 106, 0.5);
  }

  .frame-info {
    background-color: #1f1f1f;
  }

  .frame-placeholder {
    background-color: #2f2f2f;
    border-color: #555;
  }

  .placeholder-text {
    color: #aaa;
  }

  .selection-info {
    background-color: #1a3a52;
    border-color: #0d47a1;
  }

  .segment-item {
    background-color: #2f2f2f;
  }

  .segment-time {
    color: #aaa;
  }

  .frames-grid {
    border-color: #555;
  }

  .progress-box {
    background-color: #1a3a52;
    border-color: #0d47a1;
    color: #64b5f6;
  }

  .progress-bar {
    background-color: #0d3b66;
  }

  .error-box {
    background-color: #3e1f1f;
    border-color: #c62828;
    color: #ff8a80;
  }
}
</style>
