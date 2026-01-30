<template>
  <div class="auto-split">
    <!-- 批量模式未启动 -->
    <div v-if="!isBatchMode">
      <q-card flat bordered>
        <q-card-section>
          <div class="text-h5 q-mb-md">
            <q-icon name="auto_awesome" color="primary" size="sm" class="q-mr-sm" />
            自动拆解
          </div>

          <q-form class="q-gutter-md">
            <q-input
              v-model="batchInputDir"
              label="输入文件夹"
              readonly
              outlined
              hint="选择包含视频的文件夹"
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
                  @click="selectBatchInputDir"
                >
                  <q-tooltip>选择文件夹</q-tooltip>
                </q-btn>
              </template>
            </q-input>

            <q-input
              v-model="batchOutputDir"
              label="输出文件夹"
              readonly
              outlined
              hint="拆解后的视频保存位置"
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
                  @click="selectBatchOutputDir"
                >
                  <q-tooltip>选择文件夹</q-tooltip>
                </q-btn>
              </template>
            </q-input>

            <q-separator class="q-my-md" />

            <q-select
              v-model="algorithm"
              :options="algorithmOptions"
              label="相似度算法"
              outlined
              emit-value
              map-options
              hint="选择场景检测算法"
            >
              <template v-slot:prepend>
                <q-icon name="psychology" />
              </template>
            </q-select>

            <div>
              <div class="text-subtitle2 q-mb-sm">
                <q-icon name="tune" class="q-mr-sm" />
                相似度阈值: {{ threshold }}%
              </div>
              <q-slider
                v-model="threshold"
                :min="0"
                :max="100"
                :step="1"
                label
                label-always
                color="primary"
                markers
              />
              <div class="text-caption text-grey-7">低于此阈值时切分场景</div>
            </div>

            <q-input
              v-model.number="minDuration"
              label="最小片段秒数"
              type="number"
              outlined
              :min="0.5"
              :max="60"
              :step="0.5"
              hint="片段长度必须大于此值"
            >
              <template v-slot:prepend>
                <q-icon name="timer" />
              </template>
            </q-input>

            <q-checkbox
              v-model="unattended"
              label="无人值守模式"
              color="primary"
            >
              <template v-slot:default>
                <div class="row items-center">
                  <q-icon name="smart_toy" class="q-mr-sm" />
                  <span>无人值守模式</span>
                </div>
              </template>
            </q-checkbox>
            <div class="text-caption text-grey-7 q-ml-lg">启用后自动保留原视频并处理下一个</div>

            <q-separator class="q-my-md" />

            <q-btn
              label="开始自动拆解"
              color="primary"
              size="lg"
              icon="play_arrow"
              class="full-width"
              @click="startAutoSplit"
            />

            <q-banner v-if="error" class="bg-negative text-white" rounded>
              <template v-slot:avatar>
                <q-icon name="error" color="white" />
              </template>
              {{ error }}
            </q-banner>
          </q-form>
        </q-card-section>
      </q-card>
    </div>

    <!-- 批量模式已启动 -->
    <div v-else class="batch-mode">
      <!-- 进度信息 -->
      <q-card flat bordered class="q-mb-md">
        <q-card-section class="row items-center justify-between">
          <div class="text-h6">
            <q-icon name="auto_awesome" color="primary" class="q-mr-sm" />
            自动拆解进度: {{ currentTaskIndex + 1 }} / {{ batchTasks.length }}
          </div>
          <div class="row q-gutter-sm">
            <q-btn
              label="跳过"
              color="warning"
              icon="skip_next"
              @click="skipCurrentVideo"
            >
              <q-tooltip>跳过当前视频</q-tooltip>
            </q-btn>
            <q-btn
              label="稍后处理"
              color="info"
              icon="schedule"
              @click="postponeCurrentVideo"
            >
              <q-tooltip>将当前视频移到队列末尾</q-tooltip>
            </q-btn>
          </div>
        </q-card-section>
      </q-card>

      <q-card flat bordered class="q-mb-md">
        <q-card-section>
          <div class="text-h6 q-mb-sm">
            <q-icon name="video_file" color="primary" class="q-mr-sm" />
            当前视频: {{ batchTasks[currentTaskIndex]?.name }}
          </div>
          <div v-if="videoMetadata" class="row q-gutter-md text-grey-7">
            <div class="row items-center">
              <q-icon name="aspect_ratio" size="xs" class="q-mr-xs" />
              <span>{{ videoMetadata.width }}x{{ videoMetadata.height }}</span>
            </div>
            <div class="row items-center">
              <q-icon name="speed" size="xs" class="q-mr-xs" />
              <span>{{ videoMetadata.fps.toFixed(2) }} fps</span>
            </div>
            <div class="row items-center">
              <q-icon name="schedule" size="xs" class="q-mr-xs" />
              <span>{{ videoMetadata.duration.toFixed(2) }}s</span>
            </div>
          </div>
        </q-card-section>
      </q-card>

      <!-- 处理进度 -->
      <q-card v-if="isProcessing" flat bordered class="q-mb-md">
        <q-card-section>
          <div class="text-subtitle2 q-mb-sm">
            <q-icon name="hourglass_empty" color="primary" class="q-mr-sm" />
            {{ progressMsg }}
          </div>
          <q-linear-progress :value="progress / 100" color="primary" size="20px" rounded />
          <div class="text-center q-mt-sm text-primary text-weight-medium">{{ progress }}%</div>
        </q-card-section>
      </q-card>

      <!-- 处理完成后的操作按钮 -->
      <div v-if="currentTaskCompleted && !isProcessing && !unattended" class="row q-gutter-md">
        <q-btn
          label="删除原视频并继续"
          color="negative"
          icon="delete"
          class="col"
          @click="deleteAndNext"
        >
          <q-tooltip>删除原视频文件，处理下一个</q-tooltip>
        </q-btn>
        <q-btn
          label="保留原视频并继续"
          color="positive"
          icon="check"
          class="col"
          @click="nextWithoutDelete"
        >
          <q-tooltip>保留原视频文件，处理下一个</q-tooltip>
        </q-btn>
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

const algorithmOptions = [
  { label: '直方图（快速）', value: 'histogram' },
  { label: 'SSIM（准确）', value: 'ssim' },
  { label: '帧差异（简单）', value: 'frame_diff' }
];

const batchInputDir = ref("");
const batchOutputDir = ref("");
const algorithm = ref("ssim");
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
</style>
