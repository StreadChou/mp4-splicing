<script setup lang="ts">
import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";

// Tab 状态
const activeTab = ref<'concat' | 'split'>('concat');

// 拼接功能状态
const inputDir = ref("");
const endingVideo = ref("");
const randomCount = ref(3);
const outputDir = ref("");
const progressMsg = ref("");
const errorMsg = ref("");
const isProcessing = ref(false);
const showCompatDialog = ref(false);
const compatMessage = ref("");

// 拆解功能状态
const splitInputDir = ref("");
const splitOutputDir = ref("");
const similarityThreshold = ref(50);
const sceneDetectWindow = ref(10);
const splitProgress = ref("");
const splitError = ref("");
const isSplitting = ref(false);
const splitProgressPercent = ref(0);
const splitCurrentVideo = ref("");
const splitSegmentCount = ref(0);

// 监听拼接进度事件
listen("progress", (event) => {
  progressMsg.value = event.payload as string;
});

// 监听拆解进度事件
listen("split_progress", (event) => {
  const payload = event.payload as {
    type: 'scanning' | 'processing' | 'extracting' | 'complete'
    message: string
    percent?: number
    videoName?: string
    segmentCount?: number
  }
  splitProgress.value = payload.message;
  if (payload.percent !== undefined) {
    splitProgressPercent.value = payload.percent;
  }
  if (payload.videoName) {
    splitCurrentVideo.value = payload.videoName;
  }
  if (payload.segmentCount !== undefined) {
    splitSegmentCount.value = payload.segmentCount;
  }
});

// 选择输入目录
async function selectInputDir() {
  const selected = await open({
    directory: true,
    multiple: false,
    title: "选择输入目录",
  });
  if (selected) {
    inputDir.value = selected as string;
  }
}

// 选择结尾视频
async function selectEndingVideo() {
  const selected = await open({
    directory: false,
    multiple: false,
    title: "选择结尾视频",
    filters: [
      {
        name: "视频文件",
        extensions: ["mp4"],
      },
    ],
  });
  if (selected) {
    endingVideo.value = selected as string;
  }
}

// 选择输出目录
async function selectOutputDir() {
  const selected = await open({
    directory: true,
    multiple: false,
    title: "选择输出目录",
  });
  if (selected) {
    outputDir.value = selected as string;
  }
}

// 选择拆解输入目录
async function selectSplitInputDir() {
  const selected = await open({
    directory: true,
    multiple: false,
    title: "选择输入目录",
  });
  if (selected) {
    splitInputDir.value = selected as string;
  }
}

// 选择拆解输出目录
async function selectSplitOutputDir() {
  const selected = await open({
    directory: true,
    multiple: false,
    title: "选择输出目录",
  });
  if (selected) {
    splitOutputDir.value = selected as string;
  }
}

// 开始拼接
async function startConcat() {
  errorMsg.value = "";
  progressMsg.value = "";

  // 验证输入
  if (!inputDir.value) {
    errorMsg.value = "请选择输入目录";
    return;
  }
  if (!outputDir.value) {
    errorMsg.value = "请选择输出目录";
    return;
  }
  if (randomCount.value <= 0) {
    errorMsg.value = "随机数量必须大于 0";
    return;
  }

  isProcessing.value = true;

  try {
    const result = await invoke<string>("concat_videos", {
      inputDir: inputDir.value,
      endingVideo: endingVideo.value || null,
      randomCount: randomCount.value,
      outputDir: outputDir.value,
    });
    progressMsg.value = result;
  } catch (error) {
    const errorStr = String(error);

    // 检查是否是兼容性错误
    if (errorStr.startsWith("INCOMPATIBLE_VIDEOS:")) {
      compatMessage.value = errorStr.substring("INCOMPATIBLE_VIDEOS:".length);
      showCompatDialog.value = true;
    } else {
      errorMsg.value = errorStr;
    }
  } finally {
    isProcessing.value = false;
  }
}

// 用户选择直接拼接
async function concatDirect() {
  showCompatDialog.value = false;
  errorMsg.value = "正在尝试直接拼接...";
  // 这里暂时不实现强制直接拼接，因为可能失败
  errorMsg.value = "直接拼接可能失败，建议选择重新编码";
}

// 用户选择重新编码拼接
async function concatWithReencode() {
  showCompatDialog.value = false;
  errorMsg.value = "";
  progressMsg.value = "";
  isProcessing.value = true;

  try {
    const result = await invoke<string>("concat_videos_with_reencode", {
      inputDir: inputDir.value,
      endingVideo: endingVideo.value || null,
      randomCount: randomCount.value,
      outputDir: outputDir.value,
    });
    progressMsg.value = result;
  } catch (error) {
    errorMsg.value = String(error);
  } finally {
    isProcessing.value = false;
  }
}

// 取消对话框
function cancelDialog() {
  showCompatDialog.value = false;
}

// 开始拆解
async function startSplit() {
  splitError.value = "";
  splitProgress.value = "";
  splitProgressPercent.value = 0;

  // 验证输入
  if (!splitInputDir.value) {
    splitError.value = "请选择输入目录";
    return;
  }
  if (!splitOutputDir.value) {
    splitError.value = "请选择输出目录";
    return;
  }
  if (similarityThreshold.value < 0 || similarityThreshold.value > 100) {
    splitError.value = "相似度阈值必须在 0-100 之间";
    return;
  }
  if (sceneDetectWindow.value < 1 || sceneDetectWindow.value > 60) {
    splitError.value = "转场检测窗口必须在 1-60 秒之间";
    return;
  }

  isSplitting.value = true;

  try {
    const result = await invoke<string>("split_videos", {
      inputDir: splitInputDir.value,
      outputDir: splitOutputDir.value,
      similarityThreshold: similarityThreshold.value,
      sceneDetectWindow: sceneDetectWindow.value,
    });
    splitProgress.value = result;
  } catch (error) {
    splitError.value = String(error);
  } finally {
    isSplitting.value = false;
  }
}
</script>

<template>
  <main class="container">
    <h1>MP4 视频处理工具</h1>

    <!-- Tab 导航栏 -->
    <div class="tab-nav">
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'concat' }"
        @click="activeTab = 'concat'"
      >
        视频拼接
      </button>
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'split' }"
        @click="activeTab = 'split'"
      >
        视频拆解
      </button>
    </div>

    <!-- 拼接功能区域 -->
    <div v-show="activeTab === 'concat'" class="tab-content">
      <div class="form-group">
        <label>输入目录 *</label>
        <div class="input-row">
          <input v-model="inputDir" placeholder="选择包含 MP4 文件的目录" readonly />
          <button @click="selectInputDir" :disabled="isProcessing">选择</button>
        </div>
      </div>

      <div class="form-group">
        <label>结尾视频（可选）</label>
        <div class="input-row">
          <input v-model="endingVideo" placeholder="选择结尾视频文件" readonly />
          <button @click="selectEndingVideo" :disabled="isProcessing">选择</button>
        </div>
      </div>

      <div class="form-group">
        <label>随机视频数量 *</label>
        <input v-model.number="randomCount" type="number" min="1" :disabled="isProcessing" />
      </div>

      <div class="form-group">
        <label>输出目录 *</label>
        <div class="input-row">
          <input v-model="outputDir" placeholder="选择输出目录" readonly />
          <button @click="selectOutputDir" :disabled="isProcessing">选择</button>
        </div>
      </div>

      <button class="start-btn" @click="startConcat" :disabled="isProcessing">
        {{ isProcessing ? "处理中..." : "开始拼接" }}
      </button>

      <div v-if="progressMsg" class="progress-box">
        {{ progressMsg }}
      </div>

      <div v-if="errorMsg" class="error-box">
        {{ errorMsg }}
      </div>

      <!-- 兼容性确认对话框 -->
      <div v-if="showCompatDialog" class="dialog-overlay">
        <div class="dialog">
          <h2>视频格式不兼容</h2>
          <p class="compat-message">{{ compatMessage }}</p>
          <p>请选择处理方式：</p>
          <div class="dialog-buttons">
            <button @click="concatDirect" class="btn-warning">直接拼接（可能失败）</button>
            <button @click="concatWithReencode" class="btn-primary">重新编码后拼接（较慢但保证成功）</button>
            <button @click="cancelDialog" class="btn-secondary">取消</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 拆解功能区域 -->
    <div v-show="activeTab === 'split'" class="tab-content">
      <div class="form-group">
        <label>输入目录 *</label>
        <div class="input-row">
          <input v-model="splitInputDir" placeholder="选择包含 MP4 文件的目录" readonly />
          <button @click="selectSplitInputDir" :disabled="isSplitting">选择</button>
        </div>
      </div>

      <div class="form-group">
        <label>输出目录 *</label>
        <div class="input-row">
          <input v-model="splitOutputDir" placeholder="选择输出目录" readonly />
          <button @click="selectSplitOutputDir" :disabled="isSplitting">选择</button>
        </div>
      </div>

      <div class="form-group">
        <label>相似度阈值：{{ similarityThreshold }}%</label>
        <input
          v-model.number="similarityThreshold"
          type="range"
          min="0"
          max="100"
          step="5"
          :disabled="isSplitting"
          class="slider"
        />
        <div class="slider-labels">
          <span>0%</span>
          <span>50%</span>
          <span>100%</span>
        </div>
      </div>

      <div class="form-group">
        <label>转场检测窗口（秒）*</label>
        <input
          v-model.number="sceneDetectWindow"
          type="number"
          min="1"
          max="60"
          :disabled="isSplitting"
        />
      </div>

      <button class="start-btn" @click="startSplit" :disabled="isSplitting">
        {{ isSplitting ? "处理中..." : "开始拆解" }}
      </button>

      <div v-if="splitProgress" class="progress-box">
        <div>{{ splitProgress }}</div>
        <div v-if="splitProgressPercent > 0" class="progress-bar">
          <div class="progress-fill" :style="{ width: splitProgressPercent + '%' }"></div>
        </div>
        <div v-if="splitProgressPercent > 0" class="progress-percent">{{ splitProgressPercent }}%</div>
      </div>

      <div v-if="splitError" class="error-box">
        {{ splitError }}
      </div>
    </div>
  </main>
</template>

<style scoped>
.container {
  max-width: 550px;
  margin: 0 auto;
  padding: 20px;
}

h1 {
  text-align: center;
  margin-bottom: 30px;
  font-size: 24px;
}

/* Tab 导航栏样式 */
.tab-nav {
  display: flex;
  gap: 0;
  margin-bottom: 30px;
  border-bottom: 2px solid #e0e0e0;
}

.tab-btn {
  flex: 1;
  padding: 12px 20px;
  border: none;
  background-color: transparent;
  color: #666;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  border-bottom: 3px solid transparent;
  transition: all 0.25s;
  margin-bottom: -2px;
}

.tab-btn:hover {
  color: #333;
}

.tab-btn.active {
  color: #396cd8;
  border-bottom-color: #396cd8;
}

.tab-content {
  animation: fadeIn 0.2s ease-in;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.form-group {
  margin-bottom: 20px;
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
  border-radius: 8px;
  border: 1px solid #ccc;
  padding: 10px;
  font-size: 14px;
  font-family: inherit;
  background-color: #ffffff;
}

input[readonly] {
  background-color: #f5f5f5;
  cursor: pointer;
}

input[type="number"] {
  width: 100%;
}

input[type="range"] {
  width: 100%;
  height: 6px;
  cursor: pointer;
}

.slider-labels {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #999;
  margin-top: 4px;
}

button {
  border-radius: 8px;
  border: 1px solid transparent;
  padding: 10px 20px;
  font-size: 14px;
  font-weight: 500;
  font-family: inherit;
  background-color: #396cd8;
  color: white;
  cursor: pointer;
  transition: background-color 0.25s;
}

button:hover:not(:disabled) {
  background-color: #2d5ab8;
}

button:disabled {
  background-color: #ccc;
  cursor: not-allowed;
}

.start-btn {
  width: 100%;
  padding: 12px;
  font-size: 16px;
  margin-top: 10px;
}

.progress-box {
  margin-top: 20px;
  padding: 15px;
  background-color: #e7f3ff;
  border: 1px solid #2196f3;
  border-radius: 8px;
  color: #0d47a1;
  white-space: pre-wrap;
}

.progress-bar {
  width: 100%;
  height: 8px;
  background-color: #d0e8ff;
  border-radius: 4px;
  margin-top: 10px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background-color: #2196f3;
  transition: width 0.3s ease;
}

.progress-percent {
  text-align: right;
  font-size: 12px;
  margin-top: 4px;
}

.error-box {
  margin-top: 20px;
  padding: 15px;
  background-color: #ffebee;
  border: 1px solid #f44336;
  border-radius: 8px;
  color: #c62828;
  white-space: pre-wrap;
}

/* 对话框样式 */
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.dialog {
  background-color: white;
  border-radius: 12px;
  padding: 24px;
  max-width: 500px;
  width: 90%;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
}

.dialog h2 {
  margin-top: 0;
  margin-bottom: 16px;
  font-size: 20px;
  color: #f44336;
}

.compat-message {
  background-color: #fff3cd;
  border: 1px solid #ffc107;
  border-radius: 6px;
  padding: 12px;
  margin-bottom: 16px;
  white-space: pre-wrap;
  font-size: 13px;
  color: #856404;
}

.dialog-buttons {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 20px;
}

.btn-primary {
  background-color: #4caf50;
}

.btn-primary:hover {
  background-color: #45a049;
}

.btn-warning {
  background-color: #ff9800;
}

.btn-warning:hover {
  background-color: #e68900;
}

.btn-secondary {
  background-color: #9e9e9e;
}

.btn-secondary:hover {
  background-color: #757575;
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

  .dialog {
    background-color: #2f2f2f;
    color: #f6f6f6;
  }

  .compat-message {
    background-color: #3e3420;
    border-color: #8b7000;
    color: #ffd54f;
  }

  .tab-nav {
    border-bottom-color: #444;
  }

  .tab-btn {
    color: #aaa;
  }

  .tab-btn:hover {
    color: #ddd;
  }

  .tab-btn.active {
    color: #64b5f6;
    border-bottom-color: #64b5f6;
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

  .slider-labels {
    color: #666;
  }
}
</style>
