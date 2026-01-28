<template>
  <div class="batch-split">
    <!-- 批量模式未启动 -->
    <div v-if="!isBatchMode">
      <div class="form-group">
        <label>输入文件夹 *</label>
        <div class="input-row">
          <input v-model="batchInputDir" placeholder="选择包含视频的文件夹" readonly />
          <button @click="selectBatchInputDir">选择</button>
        </div>
      </div>

      <div class="form-group">
        <label>输出文件夹 *</label>
        <div class="input-row">
          <input v-model="batchOutputDir" placeholder="选择输出文件夹" readonly />
          <button @click="selectBatchOutputDir">选择</button>
        </div>
      </div>

      <button class="start-btn" @click="startBatchSplit">
        开始读取
      </button>

      <div v-if="error" class="error-box">
        {{ error }}
      </div>
    </div>

    <!-- 批量模式已启动 -->
    <div v-else class="batch-mode">
      <!-- 进度信息 -->
      <div class="batch-header">
        <h3>批量拆解进度: {{ currentTaskIndex + 1 }} / {{ batchTasks.length }}</h3>
        <div class="batch-actions">
          <button @click="skipCurrentVideo" class="btn-skip">跳过（不拆解）</button>
          <button @click="postponeCurrentVideo" class="btn-later">稍后拆解</button>
        </div>
      </div>

      <VideoSplitter
        v-if="videoMetadata"
        ref="splitterRef"
        :video-metadata="videoMetadata"
        :all-frames="allFrames"
        :is-loading-frames="isLoadingFrames"
        :frame-progress="frameProgress"
        :frame-progress-msg="frameProgressMsg"
        :is-generating-segments="isGeneratingSegments"
        :segment-progress="segmentProgress"
        :progress-msg="progressMsg"
        :error="error"
        :title="`当前视频: ${batchTasks[currentTaskIndex]?.name}`"
        :hide-generate-button="true"
        @generate="handleGenerate"
        @segments-change="onSegmentsChange"
      />

      <!-- 生成按钮 -->
      <button
        v-if="hasSegments && !isGeneratingSegments && !segmentsGenerated"
        class="start-btn"
        @click="generateCurrentVideo"
      >
        开始生成
      </button>

      <!-- 生成中的进度 -->
      <div v-if="isGeneratingSegments" class="progress-box">
        {{ progressMsg }}
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: segmentProgress + '%' }"></div>
        </div>
        <div class="progress-percent">{{ segmentProgress }}%</div>
      </div>

      <!-- 生成完成后的操作按钮 -->
      <div v-if="segmentsGenerated && !isGeneratingSegments" class="batch-complete-actions">
        <button @click="deleteAndNext" class="btn-delete">删除本视频并编辑下一个</button>
        <button @click="nextWithoutDelete" class="btn-next">不删除直接编辑下一个</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import VideoSplitter from "./VideoSplitter.vue";

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

interface VideoTask {
  path: string;
  name: string;
  status: string;
  frames?: FrameInfo[];
  metadata?: VideoMetadata;
}

interface BatchProgress {
  input_dir: string;
  output_dir: string;
  tasks: VideoTask[];
  current_index: number;
}

const batchInputDir = ref("");
const batchOutputDir = ref("");
const batchTasks = ref<VideoTask[]>([]);
const currentTaskIndex = ref(0);
const isBatchMode = ref(false);
const batchProgressFile = ref("");

const videoMetadata = ref<VideoMetadata | null>(null);
const allFrames = ref<FrameInfo[]>([]);
const isLoadingFrames = ref(false);
const isGeneratingSegments = ref(false);
const frameProgress = ref(0);
const frameProgressMsg = ref("");
const segmentProgress = ref(0);
const progressMsg = ref("");
const error = ref("");
const splitterRef = ref<InstanceType<typeof VideoSplitter> | null>(null);
const hasSegments = ref(false);
const segmentsGenerated = ref(false);

const currentSegments = computed(() => splitterRef.value?.selectedSegments || []);

// 监听帧提取进度
listen("frame_progress", (event) => {
  const payload = event.payload as { message: string; percent: number };
  frameProgressMsg.value = payload.message;
  frameProgress.value = payload.percent;
});

// 监听片段生成进度
listen("segment_progress", (event) => {
  const payload = event.payload as {
    current: number;
    total: number;
    segmentName: string;
    percent: number;
  };
  segmentProgress.value = payload.percent;
  progressMsg.value = `正在生成: ${payload.segmentName}`;
});

function onSegmentsChange(segments: SegmentRange[]) {
  hasSegments.value = segments.length > 0;
}

async function selectBatchInputDir() {
  const selected = await open({
    directory: true,
    multiple: false,
    title: "选择包含视频的文件夹",
  });
  if (selected) {
    batchInputDir.value = selected as string;
  }
}

async function selectBatchOutputDir() {
  const selected = await open({
    directory: true,
    multiple: false,
    title: "选择输出文件夹",
  });
  if (selected) {
    batchOutputDir.value = selected as string;
  }
}

async function startBatchSplit() {
  if (!batchInputDir.value || !batchOutputDir.value) {
    error.value = "请选择输入和输出目录";
    return;
  }

  try {
    const files = await invoke<string[]>("list_mp4_files", {
      dirPath: batchInputDir.value,
    });

    if (files.length === 0) {
      error.value = "目录中没有找到 MP4 文件";
      return;
    }

    batchTasks.value = files.map((path) => ({
      path,
      name: path.split("/").pop() || path,
      status: "pending",
    }));

    currentTaskIndex.value = 0;
    isBatchMode.value = true;

    await loadBatchProgress();
    await loadCurrentTask();
    preloadNextTasks();
  } catch (err) {
    error.value = String(err);
  }
}

async function loadBatchProgress() {
  try {
    const progressPath = `${batchOutputDir.value}/.mp4handler_progress.json`;
    batchProgressFile.value = progressPath;

    const progress = await invoke<BatchProgress | null>("load_batch_progress", {
      progressPath,
    });

    if (progress) {
      batchTasks.value = progress.tasks;
      currentTaskIndex.value = progress.current_index;
    }
  } catch (err) {
    // 进度文件不存在，忽略
  }
}

async function saveBatchProgress() {
  try {
    await invoke("save_batch_progress", {
      progressPath: batchProgressFile.value,
      progress: {
        input_dir: batchInputDir.value,
        output_dir: batchOutputDir.value,
        tasks: batchTasks.value,
        current_index: currentTaskIndex.value,
      },
    });
  } catch (err) {
    console.error("保存进度失败:", err);
  }
}

async function loadCurrentTask() {
  if (currentTaskIndex.value >= batchTasks.value.length) {
    alert("所有视频已处理完成！");
    isBatchMode.value = false;
    return;
  }

  const task = batchTasks.value[currentTaskIndex.value];

  if (task.status === "completed" || task.status === "skipped") {
    currentTaskIndex.value++;
    await loadCurrentTask();
    return;
  }

  task.status = "loading";
  segmentsGenerated.value = false;

  if (task.frames && task.metadata) {
    allFrames.value = task.frames;
    videoMetadata.value = task.metadata;
    task.status = "ready";
    splitterRef.value?.resetSegments();
  } else {
    try {
      videoMetadata.value = await invoke<VideoMetadata>("get_video_metadata", {
        videoPath: task.path,
      });

      isLoadingFrames.value = true;
      allFrames.value = await invoke<FrameInfo[]>("extract_all_frames", {
        videoPath: task.path,
      });

      task.frames = allFrames.value;
      task.metadata = videoMetadata.value;
      task.status = "ready";
      splitterRef.value?.resetSegments();
    } catch (err) {
      error.value = String(err);
    } finally {
      isLoadingFrames.value = false;
    }
  }

  await saveBatchProgress();
}

function preloadNextTasks() {
  for (let i = 1; i <= 2; i++) {
    const nextIndex = currentTaskIndex.value + i;
    if (nextIndex < batchTasks.value.length) {
      const task = batchTasks.value[nextIndex];
      if (task.status === "pending") {
        preloadTask(task);
      }
    }
  }
}

async function preloadTask(task: VideoTask) {
  try {
    task.status = "loading";

    const metadata = await invoke<VideoMetadata>("get_video_metadata", {
      videoPath: task.path,
    });

    const frames = await invoke<FrameInfo[]>("extract_all_frames", {
      videoPath: task.path,
    });

    task.metadata = metadata;
    task.frames = frames;
    task.status = "ready";
  } catch (err) {
    console.error("预加载失败:", err);
    task.status = "pending";
  }
}

async function skipCurrentVideo() {
  const task = batchTasks.value[currentTaskIndex.value];
  task.status = "skipped";
  await saveBatchProgress();

  currentTaskIndex.value++;
  await loadCurrentTask();
  preloadNextTasks();
}

async function postponeCurrentVideo() {
  const task = batchTasks.value[currentTaskIndex.value];
  task.status = "later";

  batchTasks.value.splice(currentTaskIndex.value, 1);
  batchTasks.value.push({ ...task, status: "pending" });

  await saveBatchProgress();
  await loadCurrentTask();
  preloadNextTasks();
}

async function generateCurrentVideo() {
  const segments = currentSegments.value;
  await handleGenerate(segments);
}

async function handleGenerate(segments: SegmentRange[]) {
  if (segments.length === 0) {
    error.value = "请至少选择一个片段";
    return;
  }

  isGeneratingSegments.value = true;
  segmentProgress.value = 0;
  error.value = "";

  try {
    const task = batchTasks.value[currentTaskIndex.value];
    const result = await invoke<string>("generate_video_segments", {
      videoPath: task.path,
      segments,
      outputDir: batchOutputDir.value,
    });
    segmentsGenerated.value = true;
    alert(result);
  } catch (err) {
    error.value = String(err);
  } finally {
    isGeneratingSegments.value = false;
  }
}

async function deleteAndNext() {
  try {
    const task = batchTasks.value[currentTaskIndex.value];
    await invoke("delete_video_file", {
      filePath: task.path,
    });

    task.status = "completed";
    await saveBatchProgress();

    currentTaskIndex.value++;
    await loadCurrentTask();
    preloadNextTasks();
  } catch (err) {
    error.value = String(err);
  }
}

async function nextWithoutDelete() {
  const task = batchTasks.value[currentTaskIndex.value];
  task.status = "completed";
  await saveBatchProgress();

  currentTaskIndex.value++;
  await loadCurrentTask();
  preloadNextTasks();
}
</script>

<style scoped>
.batch-split {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.batch-mode {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.form-group {
  margin-bottom: 20px;
  flex-shrink: 0;
}

label {
  display: block;
  margin-bottom: 8px;
  font-weight: 500;
}

.input-row {
  display: flex;
  gap: 10px;
}

input {
  flex: 1;
  padding: 10px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 14px;
}

input[readonly] {
  background-color: #f5f5f5;
  cursor: pointer;
}

button {
  padding: 10px 20px;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
  background-color: #396cd8;
  color: white;
}

button:hover:not(:disabled) {
  background-color: #2c5ab8;
}

button:disabled {
  background-color: #ccc;
  cursor: not-allowed;
}

.start-btn {
  width: 100%;
  padding: 12px 24px;
  font-size: 16px;
  font-weight: 500;
  margin-bottom: 20px;
  flex-shrink: 0;
}

.batch-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding: 15px;
  background-color: #f5f5f5;
  border-radius: 8px;
  flex-shrink: 0;
}

.batch-header h3 {
  margin: 0;
  font-size: 16px;
}

.batch-actions {
  display: flex;
  gap: 10px;
}

.btn-skip,
.btn-later {
  padding: 8px 16px;
  font-size: 13px;
}

.btn-skip {
  background-color: #ff9800;
}

.btn-skip:hover {
  background-color: #f57c00;
}

.btn-later {
  background-color: #2196f3;
}

.btn-later:hover {
  background-color: #1976d2;
}

.batch-complete-actions {
  display: flex;
  gap: 15px;
  margin-top: 20px;
  flex-shrink: 0;
}

.btn-delete,
.btn-next {
  flex: 1;
  padding: 12px 20px;
  font-size: 14px;
}

.btn-delete {
  background-color: #f44336;
}

.btn-delete:hover {
  background-color: #d32f2f;
}

.btn-next {
  background-color: #4caf50;
}

.btn-next:hover {
  background-color: #45a049;
}

.error-box {
  background-color: #ffebee;
  border: 1px solid #f44336;
  border-radius: 8px;
  padding: 15px;
  color: #c62828;
  margin-top: 20px;
  flex-shrink: 0;
}

@media (prefers-color-scheme: dark) {
  input {
    color: #ffffff;
    background-color: #2f2f2f;
    border-color: #555;
  }

  input[readonly] {
    background-color: #1f1f1f;
  }

  .batch-header {
    background-color: #2f2f2f;
      color: white;
  }

  .error-box {
    background-color: #3e1f1f;
    border-color: #c62828;
    color: #ff8a80;
  }
}
</style>
