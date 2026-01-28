<template>
  <div class="video-concat">
    <div class="form-group">
      <label>输入目录 *</label>
      <div class="input-row">
        <input v-model="inputDir" placeholder="选择包含 MP4 文件的目录" readonly />
        <button @click="selectInputDir" :disabled="isProcessing">选择</button>
      </div>
    </div>

    <div class="form-group">
      <label>最大递归层数</label>
      <input v-model.number="maxDepth" type="number" min="0" :disabled="isProcessing" />
    </div>

    <div class="form-group">
      <label>结尾视频（可选）</label>
      <div class="input-row">
        <input v-model="endingVideo" placeholder="选择结尾视频" readonly />
        <button @click="selectEndingVideo" :disabled="isProcessing">选择</button>
      </div>
    </div>

    <div class="form-group">
      <label>随机多少个视频合成一个视频 *</label>
      <input v-model="randomCountRange" type="text" placeholder="例如 2,4 表示 2-4 之间随机" :disabled="isProcessing" />
    </div>

    <div class="form-group">
      <label>执行次数（最终会生成多少个视频） *</label>
      <input v-model.number="runTimes" type="number" min="1" :disabled="isProcessing" />
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
</template>

<script setup lang="ts">
import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

const inputDir = ref("");
const endingVideo = ref("");
const maxDepth = ref(2);
const randomCountRange = ref("2,4");
const runTimes = ref(1);
const outputDir = ref("");
const progressMsg = ref("");
const errorMsg = ref("");
const isProcessing = ref(false);
const showCompatDialog = ref(false);
const compatMessage = ref("");

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

function parseRandomCountRange(value: string): { min: number; max: number } | null {
  const normalized = value.replace("，", ",").trim();
  if (!normalized) return null;

  let minStr = normalized;
  let maxStr = normalized;

  if (normalized.includes(",")) {
    const parts = normalized.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length !== 2) return null;
    [minStr, maxStr] = parts;
  } else if (normalized.includes("-")) {
    const parts = normalized.split("-").map((s) => s.trim()).filter(Boolean);
    if (parts.length !== 2) return null;
    [minStr, maxStr] = parts;
  }

  const min = Number(minStr);
  const max = Number(maxStr);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  if (min <= 0 || max <= 0) return null;

  return min <= max ? { min, max } : { min: max, max: min };
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
  if (maxDepth.value < 0) {
    errorMsg.value = "最大递归层数不能小于 0";
    return;
  }
  const range = parseRandomCountRange(randomCountRange.value);
  if (!range) {
    errorMsg.value = "随机数量格式错误，请输入如 2,4 或 3";
    return;
  }
  if (runTimes.value <= 0) {
    errorMsg.value = "执行次数必须大于 0";
    return;
  }

  isProcessing.value = true;

  try {
    const result = await invoke<string>("concat_videos", {
      inputDir: inputDir.value,
      endingVideo: endingVideo.value || null,
      randomCountMin: range.min,
      randomCountMax: range.max,
      maxDepth: maxDepth.value,
      runTimes: runTimes.value,
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
  errorMsg.value = "直接拼接可能失败，建议选择重新编码";
}

// 用户选择重新编码拼接
async function concatWithReencode() {
  showCompatDialog.value = false;
  errorMsg.value = "";
  progressMsg.value = "";
  isProcessing.value = true;

  try {
    const range = parseRandomCountRange(randomCountRange.value);
    if (!range) {
      errorMsg.value = "随机数量格式错误，请输入如 2,4 或 3";
      return;
    }
    if (runTimes.value <= 0) {
      errorMsg.value = "执行次数必须大于 0";
      return;
    }

    const result = await invoke<string>("concat_videos_with_reencode", {
      inputDir: inputDir.value,
      endingVideo: endingVideo.value || null,
      randomCountMin: range.min,
      randomCountMax: range.max,
      maxDepth: maxDepth.value,
      runTimes: runTimes.value,
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
</script>

<style scoped>
.video-concat {
  max-width: 600px;
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
  padding: 10px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 14px;
}

input[readonly] {
  background-color: #f5f5f5;
  cursor: pointer;
}

input[type="number"] {
  width: 100%;
}

button {
  padding: 10px 20px;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
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
  background-color: #396cd8;
  color: white;
}

.start-btn:hover:not(:disabled) {
  background-color: #2c5ab8;
}

.progress-box {
  background-color: #e7f3ff;
  border: 1px solid #2196f3;
  border-radius: 8px;
  padding: 15px;
  margin-top: 20px;
}

.error-box {
  background-color: #ffebee;
  border: 1px solid #f44336;
  border-radius: 8px;
  padding: 15px;
  color: #c62828;
  margin-top: 20px;
}

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
  padding: 30px;
  max-width: 500px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
}

.dialog h2 {
  margin-top: 0;
  margin-bottom: 15px;
  font-size: 20px;
}

.compat-message {
  background-color: #fff3cd;
  border: 1px solid #ffc107;
  border-radius: 6px;
  padding: 12px;
  margin-bottom: 15px;
  color: #856404;
}

.dialog-buttons {
  display: flex;
  gap: 10px;
  margin-top: 20px;
}

.dialog-buttons button {
  flex: 1;
}

.btn-warning {
  background-color: #ff9800;
  color: white;
}

.btn-warning:hover {
  background-color: #f57c00;
}

.btn-primary {
  background-color: #4caf50;
  color: white;
}

.btn-primary:hover {
  background-color: #45a049;
}

.btn-secondary {
  background-color: #9e9e9e;
  color: white;
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

  .progress-box {
    background-color: #1a3a52;
    border-color: #0d47a1;
    color: #64b5f6;
  }

  .error-box {
    background-color: #3e1f1f;
    border-color: #c62828;
    color: #ff8a80;
  }
}
</style>
