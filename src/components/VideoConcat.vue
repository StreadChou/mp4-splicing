<template>
  <div class="video-concat">
    <q-card flat bordered>
      <q-card-section>
        <div class="text-h5 q-mb-md">
          <q-icon name="merge" color="primary" size="sm" class="q-mr-sm" />
          视频拼接
        </div>

        <q-form class="q-gutter-md" style="max-width: 800px">
          <q-input
            v-model="inputDir"
            label="输入目录"
            readonly
            outlined
            :disable="isProcessing"
            hint="选择包含 MP4 文件的目录"
          >
            <template v-slot:prepend>
              <q-icon name="folder" />
            </template>
            <template v-slot:append>
              <q-btn
                icon="folder_open"
                color="primary"
                flat
                round
                dense
                @click="selectInputDir"
                :disable="isProcessing"
              >
                <q-tooltip>选择目录</q-tooltip>
              </q-btn>
            </template>
          </q-input>

          <q-input
            v-model.number="maxDepth"
            label="最大递归层数"
            type="number"
            outlined
            :disable="isProcessing"
            :rules="[val => val >= 0 || '不能小于 0']"
            hint="搜索子目录的深度"
          >
            <template v-slot:prepend>
              <q-icon name="account_tree" />
            </template>
          </q-input>

          <q-input
            v-model="endingVideo"
            label="结尾视频（可选）"
            readonly
            outlined
            :disable="isProcessing"
            hint="在每个拼接视频末尾添加的固定视频"
          >
            <template v-slot:prepend>
              <q-icon name="video_file" />
            </template>
            <template v-slot:append>
              <q-btn
                icon="folder_open"
                color="primary"
                flat
                round
                dense
                @click="selectEndingVideo"
                :disable="isProcessing"
              >
                <q-tooltip>选择视频</q-tooltip>
              </q-btn>
            </template>
          </q-input>

          <q-input
            v-model="randomCountRange"
            label="随机视频数量"
            placeholder="例如 2,4 表示 2-4 之间随机"
            outlined
            :disable="isProcessing"
            hint="每个拼接视频包含的随机视频数量范围"
          >
            <template v-slot:prepend>
              <q-icon name="shuffle" />
            </template>
          </q-input>

          <q-input
            v-model.number="runTimes"
            label="执行次数"
            type="number"
            outlined
            :disable="isProcessing"
            :rules="[val => val > 0 || '必须大于 0']"
            hint="最终会生成多少个拼接视频"
          >
            <template v-slot:prepend>
              <q-icon name="repeat" />
            </template>
          </q-input>

          <q-input
            v-model="outputDir"
            label="输出目录"
            readonly
            outlined
            :disable="isProcessing"
            hint="拼接后的视频保存位置"
          >
            <template v-slot:prepend>
              <q-icon name="save" />
            </template>
            <template v-slot:append>
              <q-btn
                icon="folder_open"
                color="primary"
                flat
                round
                dense
                @click="selectOutputDir"
                :disable="isProcessing"
              >
                <q-tooltip>选择目录</q-tooltip>
              </q-btn>
            </template>
          </q-input>

          <q-separator class="q-my-md" />

          <q-btn
            :label="isProcessing ? '处理中...' : '开始拼接'"
            color="primary"
            size="lg"
            icon="play_arrow"
            class="full-width"
            @click="startConcat"
            :disable="isProcessing"
            :loading="isProcessing"
          />

          <q-banner v-if="progressMsg" class="bg-positive text-white" rounded>
            <template v-slot:avatar>
              <q-icon name="check_circle" color="white" />
            </template>
            {{ progressMsg }}
          </q-banner>

          <q-banner v-if="errorMsg" class="bg-negative text-white" rounded>
            <template v-slot:avatar>
              <q-icon name="error" color="white" />
            </template>
            {{ errorMsg }}
          </q-banner>
        </q-form>
      </q-card-section>
    </q-card>

    <!-- 兼容性确认对话框 -->
    <q-dialog v-model="showCompatDialog">
      <q-card style="min-width: 400px">
        <q-card-section>
          <div class="text-h6">
            <q-icon name="warning" color="warning" class="q-mr-sm" />
            视频格式不兼容
          </div>
        </q-card-section>

        <q-card-section>
          <q-banner class="bg-warning text-dark" rounded dense>
            {{ compatMessage }}
          </q-banner>
          <p class="q-mt-md text-body2">请选择处理方式：</p>
        </q-card-section>

        <q-card-actions align="right">
          <q-btn
            label="直接拼接"
            color="warning"
            icon="fast_forward"
            @click="concatDirect"
          >
            <q-tooltip>可能失败，但速度快</q-tooltip>
          </q-btn>
          <q-btn
            label="重新编码后拼接"
            color="positive"
            icon="settings"
            @click="concatWithReencode"
          >
            <q-tooltip>较慢但保证成功</q-tooltip>
          </q-btn>
          <q-btn
            label="取消"
            color="grey"
            flat
            icon="close"
            @click="cancelDialog"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
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

