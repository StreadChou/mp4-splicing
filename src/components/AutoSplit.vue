<template>
  <div class="auto-split">
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

      <div class="form-group">
        <label>相似度算法</label>
        <select v-model="algorithm">
          <option value="histogram">直方图（快速）</option>
          <option value="ssim">SSIM（准确）</option>
          <option value="frame_diff">帧差异（简单）</option>
        </select>
      </div>

      <div class="form-group">
        <label>相似度阈值: {{ threshold }}%</label>
        <input
          type="range"
          v-model.number="threshold"
          min="0"
          max="100"
          step="1"
          class="slider"
        />
        <div class="slider-hint">低于此阈值时切分场景</div>
      </div>

      <div class="form-group">
        <label>最小片段秒数</label>
        <input
          type="number"
          v-model.number="minDuration"
          min="0.5"
          max="60"
          step="0.5"
          placeholder="2.0"
        />
        <div class="slider-hint">片段长度必须大于此值</div>
      </div>

      <div class="form-group checkbox-group">
        <label>
          <input type="checkbox" v-model="unattended" />
          无人值守模式
        </label>
        <div class="slider-hint">启用后自动保留原视频并处理下一个</div>
      </div>

      <button class="start-btn" @click="startAutoSplit">
        开始自动拆解
      </button>

      <div v-if="error" class="error-box">
        {{ error }}
      </div>
    </div>

    <!-- 批量模式已启动 -->
    <div v-else class="batch-mode">
      <!-- 进度信息 -->
      <div class="batch-header">
        <h3>自动拆解进度: {{ currentTaskIndex + 1 }} / {{ batchTasks.length }}</h3>
        <div class="batch-actions">
          <button @click="skipCurrentVideo" class="btn-skip">跳过此视频</button>
          <button @click="postponeCurrentVideo" class="btn-later">稍后处理</button>
        </div>
      </div>

      <div class="current-video">
        <h4>当前视频: {{ batchTasks[currentTaskIndex]?.name }}</h4>
        <div v-if="videoMetadata" class="video-info">
          <span>分辨率: {{ videoMetadata.width }}x{{ videoMetadata.height }}</span>
          <span>帧率: {{ videoMetadata.fps.toFixed(2) }} fps</span>
          <span>时长: {{ videoMetadata.duration.toFixed(2) }}s</span>
        </div>
      </div>

      <!-- 处理进度 -->
      <div v-if="isProcessing" class="progress-box">
        {{ progressMsg }}
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: progress + '%' }"></div>
        </div>
        <div class="progress-percent">{{ progress }}%</div>
      </div>

      <!-- 处理完成后的操作按钮 -->
      <div v-if="currentTaskCompleted && !isProcessing && !unattended" class="batch-complete-actions">
        <button @click="deleteAndNext" class="btn-delete">删除原视频并处理下一个</button>
        <button @click="nextWithoutDelete" class="btn-next">保留原视频并处理下一个</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";

interface VideoMetadata {
  width: number;
  height: number;
  fps: number;
  duration: number;
  total_frames: number;
  codec: string;
}

interface VideoTask {
  path: string;
  name: string;
  status: string;
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
const algorithm = ref("histogram");
const threshold = ref(70);
const minDuration = ref(2.0);
const unattended = ref(false);

const batchTasks = ref<VideoTask[]>([]);
const currentTaskIndex = ref(0);
const isBatchMode = ref(false);
const batchProgressFile = ref("");

const videoMetadata = ref<VideoMetadata | null>(null);
const isProcessing = ref(false);
const progress = ref(0);
const progressMsg = ref("");
const error = ref("");
const currentTaskCompleted = ref(false);

// 监听自动拆解进度
listen("auto_split_progress", (event) => {
  const payload = event.payload as { message: string; percent: number };
  progressMsg.value = payload.message;
  progress.value = payload.percent;
});

// 监听片段生成进度
listen("segment_progress", (event) => {
  const payload = event.payload as {
    current: number;
    total: number;
    segmentName: string;
    percent: number;
  };
  progress.value = 70 + (payload.percent * 0.3);
  progressMsg.value = `正在生成: ${payload.segmentName}`;
});

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

async function startAutoSplit() {
  if (!batchInputDir.value || !batchOutputDir.value) {
    error.value = "请选择输入和输出目录";
    return;
  }

  if (threshold.value < 0 || threshold.value > 100) {
    error.value = "相似度阈值必须在 0-100 之间";
    return;
  }

  if (minDuration.value < 0.5) {
    error.value = "最小片段秒数不能小于 0.5";
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
    await processCurrentTask();
  } catch (err) {
    error.value = String(err);
  }
}

async function loadBatchProgress() {
  try {
    const progressPath = `${batchOutputDir.value}/.mp4handler_auto_progress.json`;
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

async function processCurrentTask() {
  if (currentTaskIndex.value >= batchTasks.value.length) {
    alert("所有视频已处理完成！");
    isBatchMode.value = false;
    return;
  }

  const task = batchTasks.value[currentTaskIndex.value];

  if (task.status === "completed" || task.status === "skipped") {
    currentTaskIndex.value++;
    await processCurrentTask();
    return;
  }

  task.status = "processing";
  currentTaskCompleted.value = false;
  isProcessing.value = true;
  progress.value = 0;
  error.value = "";

  try {
    // 获取视频元数据
    videoMetadata.value = await invoke<VideoMetadata>("get_video_metadata", {
      videoPath: task.path,
    });
    task.metadata = videoMetadata.value;

    // 调用自动拆解命令
    const result = await invoke<string>("auto_split_video", {
      videoPath: task.path,
      outputDir: batchOutputDir.value,
      algorithm: algorithm.value,
      threshold: threshold.value / 100.0, // 转换为 0-1 范围
      minDuration: minDuration.value,
    });

    currentTaskCompleted.value = true;

    // 无人值守模式：自动保留原视频并继续下一个
    if (unattended.value) {
      task.status = "completed";
      await saveBatchProgress();
      currentTaskIndex.value++;
      await processCurrentTask();
    } else {
      alert(result);
    }
  } catch (err) {
    error.value = String(err);
    task.status = "error";
  } finally {
    isProcessing.value = false;
  }

  await saveBatchProgress();
}

async function skipCurrentVideo() {
  const task = batchTasks.value[currentTaskIndex.value];
  task.status = "skipped";
  await saveBatchProgress();

  currentTaskIndex.value++;
  await processCurrentTask();
}

async function postponeCurrentVideo() {
  const task = batchTasks.value[currentTaskIndex.value];
  task.status = "later";

  batchTasks.value.splice(currentTaskIndex.value, 1);
  batchTasks.value.push({ ...task, status: "pending" });

  await saveBatchProgress();
  await processCurrentTask();
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
    await processCurrentTask();
  } catch (err) {
    error.value = String(err);
  }
}

async function nextWithoutDelete() {
  const task = batchTasks.value[currentTaskIndex.value];
  task.status = "completed";
  await saveBatchProgress();

  currentTaskIndex.value++;
  await processCurrentTask();
}
</script>

<style scoped>
.auto-split {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 20px;
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

input[type="text"],
input[type="number"],
select {
  width: 100%;
  padding: 10px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 14px;
}

input[readonly] {
  background-color: #f5f5f5;
  cursor: pointer;
}

select {
  cursor: pointer;
  background-color: white;
}

.checkbox-group label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-weight: 500;
}

.checkbox-group input[type="checkbox"] {
  width: auto;
  cursor: pointer;
}

.slider {
  width: 100%;
  height: 6px;
  border-radius: 3px;
  background: #ddd;
  outline: none;
  -webkit-appearance: none;
}

.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #396cd8;
  cursor: pointer;
}

.slider::-moz-range-thumb {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #396cd8;
  cursor: pointer;
  border: none;
}

.slider-hint {
  font-size: 12px;
  color: #666;
  margin-top: 5px;
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

.current-video {
  background-color: #f9f9f9;
  padding: 15px;
  border-radius: 8px;
  margin-bottom: 20px;
}

.current-video h4 {
  margin: 0 0 10px 0;
  font-size: 15px;
}

.video-info {
  display: flex;
  gap: 20px;
  font-size: 13px;
  color: #666;
}

.progress-box {
  background-color: #f5f5f5;
  padding: 20px;
  border-radius: 8px;
  margin-bottom: 20px;
}

.progress-bar {
  width: 100%;
  height: 24px;
  background-color: #e0e0e0;
  border-radius: 12px;
  overflow: hidden;
  margin: 10px 0;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #396cd8, #2c5ab8);
  transition: width 0.3s ease;
}

.progress-percent {
  text-align: center;
  font-weight: 500;
  color: #396cd8;
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
  input[type="text"],
  input[type="number"],
  select {
    color: #ffffff;
    background-color: #2f2f2f;
    border-color: #555;
  }

  input[readonly] {
    background-color: #1f1f1f;
  }

  select {
    background-color: #2f2f2f;
  }

  .slider {
    background: #555;
  }

  .slider-hint {
    color: #aaa;
  }

  .batch-header {
    background-color: #2f2f2f;
    color: white;
  }

  .current-video {
    background-color: #2f2f2f;
    color: white;
  }

  .video-info {
    color: #aaa;
  }

  .progress-box {
    background-color: #2f2f2f;
    color: white;
  }

  .progress-bar {
    background-color: #555;
  }

  .error-box {
    background-color: #3e1f1f;
    border-color: #c62828;
    color: #ff8a80;
  }
}
</style>
