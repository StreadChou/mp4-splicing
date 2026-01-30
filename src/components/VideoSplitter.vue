<template>
  <div class="video-splitter">
    <!-- 视频信息卡片 -->
    <q-card v-if="videoMetadata" flat bordered class="q-mb-md">
      <q-card-section>
        <div class="text-h6 q-mb-sm">
          <q-icon name="info" color="primary" class="q-mr-sm" />
          {{ title || '视频信息' }}
        </div>
        <div class="row q-gutter-md">
          <div class="col">
            <q-chip icon="aspect_ratio" color="primary" text-color="white">
              {{ videoMetadata.width }}x{{ videoMetadata.height }}
            </q-chip>
          </div>
          <div class="col">
            <q-chip icon="speed" color="primary" text-color="white">
              {{ videoMetadata.fps.toFixed(2) }} fps
            </q-chip>
          </div>
          <div class="col">
            <q-chip icon="schedule" color="primary" text-color="white">
              {{ videoMetadata.duration.toFixed(2) }} 秒
            </q-chip>
          </div>
          <div class="col">
            <q-chip icon="filter" color="primary" text-color="white">
              {{ videoMetadata.total_frames }} 帧
            </q-chip>
          </div>
        </div>
      </q-card-section>
    </q-card>

    <!-- 加载状态 -->
    <q-card v-if="isLoadingFrames" flat bordered class="q-mb-md">
      <q-card-section>
        <div class="text-subtitle2 q-mb-sm">
          <q-icon name="hourglass_empty" color="primary" class="q-mr-sm" />
          {{ frameProgressMsg }}
        </div>
        <q-linear-progress :value="frameProgress / 100" color="primary" size="20px" rounded />
        <div class="text-center q-mt-sm text-primary text-weight-medium">{{ frameProgress }}%</div>
      </q-card-section>
    </q-card>

    <!-- 帧选择区域 -->
    <q-card v-if="allFrames.length > 0" flat bordered class="frames-card q-mb-md">
      <q-card-section>
        <div class="text-h6 q-mb-md">
          <q-icon name="grid_view" color="primary" class="q-mr-sm" />
          视频帧（点击选择起始和结束帧）
        </div>

        <!-- 滚动区域 -->
        <q-scroll-area style="height: 400px;" class="frames-scroll-area">
          <div class="frames-grid">
            <template v-for="frame in allFrames" :key="frame.frame_number">
              <!-- 如果是片段的第一帧，显示占位符 -->
              <q-card v-if="isSegmentStart(frame.frame_number)" flat bordered class="frame-placeholder">
                <q-card-section class="text-center">
                  <q-icon name="folder" size="md" color="grey-6" />
                  <div class="text-caption text-grey-7 q-mt-xs">
                    帧 {{ getSegmentRange(frame.frame_number) }}<br>已添加到片段
                  </div>
                </q-card-section>
              </q-card>

              <!-- 如果帧在片段中但不是第一帧，跳过不显示 -->
              <template v-else-if="isFrameInSegment(frame.frame_number)">
                <!-- 不渲染任何内容 -->
              </template>

              <!-- 否则显示正常的帧 -->
              <q-card
                v-else
                flat
                bordered
                class="frame-item cursor-pointer"
                :class="{
                  'frame-selected': currentSelection && frame.frame_number >= currentSelection.start && frame.frame_number <= currentSelection.end
                }"
                @click="selectFrame(frame.frame_number)"
              >
                <img :src="convertAssetPath(frame.image_path)" :alt="`帧 ${frame.frame_number}`" class="frame-image" />
                <q-card-section class="frame-info q-pa-xs">
                  <div class="text-caption text-center">
                    <div>帧 {{ frame.frame_number }}</div>
                    <div>{{ frame.timestamp.toFixed(2) }}s</div>
                  </div>
                </q-card-section>
              </q-card>
            </template>
          </div>
        </q-scroll-area>

        <!-- 当前选择信息 -->
        <q-banner v-if="currentSelection" class="bg-blue-1 q-mt-md" rounded dense>
          <template v-slot:avatar>
            <q-icon name="check_circle" color="primary" />
          </template>
          <div class="row items-center q-gutter-sm">
            <span>
              当前选择: 帧 {{ currentSelection.start }} - {{ currentSelection.end }}
              ({{ (currentSelection.start / videoMetadata!.fps).toFixed(2) }}s - {{ (currentSelection.end / videoMetadata!.fps).toFixed(2) }}s)
            </span>
            <q-space />
            <q-btn
              label="添加到片段"
              color="positive"
              icon="add"
              size="sm"
              @click="addSegment"
            />
            <q-btn
              label="取消"
              color="grey"
              icon="close"
              flat
              size="sm"
              @click="currentSelection = null"
            />
          </div>
        </q-banner>
      </q-card-section>
    </q-card>

    <!-- 已选片段列表 -->
    <q-card v-if="selectedSegments.length > 0" flat bordered class="q-mb-md">
      <q-card-section>
        <div class="text-h6 q-mb-md">
          <q-icon name="playlist_add_check" color="primary" class="q-mr-sm" />
          已选片段
        </div>
        <q-list bordered separator>
          <q-item v-for="(segment, index) in selectedSegments" :key="index">
            <q-item-section>
              <q-item-label>片段 {{ index + 1 }}: 帧 {{ segment.start_frame }} - {{ segment.end_frame }}</q-item-label>
              <q-item-label caption>
                {{ (segment.start_frame / videoMetadata!.fps).toFixed(2) }}s - {{ (segment.end_frame / videoMetadata!.fps).toFixed(2) }}s
              </q-item-label>
            </q-item-section>
            <q-item-section side>
              <q-btn
                icon="delete"
                color="negative"
                flat
                round
                dense
                @click="removeSegment(index)"
              >
                <q-tooltip>删除片段</q-tooltip>
              </q-btn>
            </q-item-section>
          </q-item>
        </q-list>
      </q-card-section>
    </q-card>

    <!-- 生成按钮 -->
    <q-btn
      v-if="selectedSegments.length > 0 && !hideGenerateButton"
      label="开始生成"
      color="primary"
      size="lg"
      icon="play_arrow"
      class="full-width q-mb-md"
      @click="handleGenerate"
      :disable="isGeneratingSegments"
      :loading="isGeneratingSegments"
    />

    <!-- 生成进度 -->
    <q-card v-if="isGeneratingSegments" flat bordered class="q-mb-md">
      <q-card-section>
        <div class="text-subtitle2 q-mb-sm">
          <q-icon name="hourglass_empty" color="primary" class="q-mr-sm" />
          {{ progressMsg }}
        </div>
        <q-linear-progress :value="segmentProgress / 100" color="primary" size="20px" rounded />
        <div class="text-center q-mt-sm text-primary text-weight-medium">{{ segmentProgress }}%</div>
      </q-card-section>
    </q-card>

    <!-- 错误信息 -->
    <q-banner v-if="error" class="bg-negative text-white q-mb-md" rounded>
      <template v-slot:avatar>
        <q-icon name="error" color="white" />
      </template>
      {{ error }}
    </q-banner>
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
}

.frames-scroll-area {
  border: 1px solid #e0e0e0;
  border-radius: 8px;
}

.frames-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 12px;
  padding: 16px;
}

.frame-item {
  transition: all 0.2s;
  height: 140px;
  display: flex;
  flex-direction: column;
}

.frame-item:hover {
  transform: scale(1.05);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.frame-item.frame-selected {
  border: 3px solid #4caf50 !important;
  box-shadow: 0 0 12px rgba(76, 175, 80, 0.6);
}

.frame-image {
  width: 100%;
  height: 100px;
  object-fit: cover;
  display: block;
}

.frame-info {
  background-color: #f5f5f5;
  padding: 4px !important;
}

.frame-placeholder {
  height: 140px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px dashed #bdbdbd !important;
}
</style>
