<template>
  <div class="batch-split">
    <!-- 批量模式未启动 -->
    <div v-if="!isBatchMode">
      <q-card flat bordered>
        <q-card-section>
          <div class="text-h5 q-mb-md">
            <q-icon name="splitscreen" color="primary" size="sm" class="q-mr-sm" />
            批量拆解
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

            <q-btn
              label="开始读取"
              color="primary"
              size="lg"
              icon="play_arrow"
              class="full-width"
              @click="startBatchSplit"
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
            <q-icon name="splitscreen" color="primary" class="q-mr-sm" />
            批量拆解进度: {{ currentTaskIndex + 1 }} / {{ batchTasks.length }}
          </div>
          <div class="row q-gutter-sm">
            <q-btn
              label="跳过"
              color="warning"
              icon="skip_next"
              @click="skipCurrentVideo"
            >
              <q-tooltip>跳过当前视频，不进行拆解</q-tooltip>
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
      <q-btn
        v-if="hasSegments && !isGeneratingSegments && !segmentsGenerated"
        label="开始生成"
        color="primary"
        size="lg"
        icon="play_arrow"
        class="full-width q-mt-md"
        @click="generateCurrentVideo"
      />

      <!-- 生成中的进度 -->
      <q-card v-if="isGeneratingSegments" flat bordered class="q-mt-md">
        <q-card-section>
          <div class="text-subtitle2 q-mb-sm">
            <q-icon name="hourglass_empty" color="primary" class="q-mr-sm" />
            {{ progressMsg }}
          </div>
          <q-linear-progress :value="segmentProgress / 100" color="primary" size="20px" rounded />
          <div class="text-center q-mt-sm text-primary text-weight-medium">{{ segmentProgress }}%</div>
        </q-card-section>
      </q-card>

      <!-- 生成完成后的操作按钮 -->
      <div v-if="segmentsGenerated && !isGeneratingSegments" class="row q-gutter-md q-mt-md">
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
</style>
