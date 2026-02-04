<template>
  <div class="remove-ending">
    <!-- 批量模式未启动 -->
    <div v-if="!isBatchMode">
      <q-card flat bordered>
        <q-card-section>
          <div class="text-h5 q-mb-md">
            <q-icon name="content_cut" color="primary" size="sm" class="q-mr-sm" />
            去结尾
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
              hint="处理后的视频保存位置"
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

            <q-separator class="q-my-md" />

            <!-- 合成选项 -->
            <div class="text-subtitle2 q-mb-sm">
              <q-icon name="settings" class="q-mr-sm" />
              合成选项
            </div>

            <div class="q-gutter-sm">
              <q-checkbox
                v-model="shuffleSegments"
                label="随机打乱剩余片段"
                color="primary"
              >
                <template v-slot:default>
                  <div class="row items-center">
                    <q-icon name="shuffle" class="q-mr-sm" />
                    <span>随机打乱剩余片段</span>
                  </div>
                </template>
              </q-checkbox>
              <div class="text-caption text-grey-7 q-ml-lg">启用后将随机打乱移除结尾后的片段顺序</div>

              <q-checkbox
                v-model="useNewEnding"
                label="使用新结尾视频"
                color="primary"
              >
                <template v-slot:default>
                  <div class="row items-center">
                    <q-icon name="video_library" class="q-mr-sm" />
                    <span>使用新结尾视频</span>
                  </div>
                </template>
              </q-checkbox>
              <div class="text-caption text-grey-7 q-ml-lg">启用后将指定的视频添加到末尾（打乱后新结尾仍在最后）</div>
            </div>

            <q-input
              v-if="useNewEnding"
              v-model="newEndingVideo"
              label="新结尾视频"
              readonly
              outlined
              hint="选择用作结尾的视频文件"
              class="q-mt-md"
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
                  @click="selectNewEndingVideo"
                >
                  <q-tooltip>选择视频文件</q-tooltip>
                </q-btn>
              </template>
            </q-input>

            <q-separator class="q-my-md" />

            <q-btn
              label="开始处理"
              color="primary"
              size="lg"
              icon="play_arrow"
              class="full-width"
              @click="startRemoveEnding"
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
            <q-icon name="content_cut" color="primary" class="q-mr-sm" />
            去结尾进度: {{ currentTaskIndex + 1 }} / {{ batchTasks.length }}
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

      <!-- 跳过的视频列表 -->
      <q-card v-if="skippedVideos.length > 0" flat bordered class="q-mb-md">
        <q-card-section>
          <div class="text-subtitle2 q-mb-sm">
            <q-icon name="warning" color="warning" class="q-mr-sm" />
            跳过的视频 ({{ skippedVideos.length }})
          </div>
          <q-list dense>
            <q-item v-for="(item, idx) in skippedVideos" :key="idx">
              <q-item-section>
                <q-item-label>{{ item.name }}</q-item-label>
                <q-item-label caption>{{ item.reason }}</q-item-label>
              </q-item-section>
            </q-item>
          </q-list>
        </q-card-section>
      </q-card>
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

interface SkippedVideo {
  name: string;
  reason: string;
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
const shuffleSegments = ref(false);
const useNewEnding = ref(false);
const newEndingVideo = ref("");

const batchTasks = ref<VideoTask[]>([]);
const currentTaskIndex = ref(0);
const isBatchMode = ref(false);

const videoMetadata = ref<VideoMetadata | null>(null);
const isProcessing = ref(false);
const progress = ref(0);
const progressMsg = ref("");
const error = ref("");
const skippedVideos = ref<SkippedVideo[]>([]);

// 监听去结尾进度
listen("remove_ending_progress", (event) => {
  const payload = event.payload as { message: string; percent: number };
  progressMsg.value = payload.message;
  progress.value = payload.percent;
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

async function selectNewEndingVideo() {
  const selected = await open({
    multiple: false,
    title: "选择新结尾视频",
    filters: [
      {
        name: "视频文件",
        extensions: ["mp4"],
      },
    ],
  });
  if (selected) {
    newEndingVideo.value = selected as string;
  }
}

async function startRemoveEnding() {
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

  if (useNewEnding.value && !newEndingVideo.value) {
    error.value = "请选择新结尾视频";
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
    skippedVideos.value = [];

    await processCurrentTask();
  } catch (err) {
    error.value = String(err);
  }
}

async function processCurrentTask() {
  if (currentTaskIndex.value >= batchTasks.value.length) {
    alert(`所有视频已处理完成！\n跳过: ${skippedVideos.value.length} 个`);
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
  isProcessing.value = true;
  progress.value = 0;
  error.value = "";

  try {
    // 获取视频元数据
    videoMetadata.value = await invoke<VideoMetadata>("get_video_metadata", {
      videoPath: task.path,
    });
    task.metadata = videoMetadata.value;

    // 调用去结尾命令
    const result = await invoke<string>("remove_ending_and_concat", {
      videoPath: task.path,
      outputDir: batchOutputDir.value,
      algorithm: algorithm.value,
      threshold: threshold.value / 100.0,
      minDuration: minDuration.value,
      newEndingVideo: useNewEnding.value ? newEndingVideo.value : null,
      shuffleSegments: shuffleSegments.value,
    });

    task.status = "completed";
    alert(result);

    // 自动处理下一个
    currentTaskIndex.value++;
    await processCurrentTask();
  } catch (err) {
    const errMsg = String(err);
    error.value = errMsg;
    task.status = "skipped";

    // 记录跳过的视频
    skippedVideos.value.push({
      name: task.name,
      reason: errMsg,
    });

    // 自动处理下一个
    currentTaskIndex.value++;
    await processCurrentTask();
  } finally {
    isProcessing.value = false;
  }
}

async function skipCurrentVideo() {
  const task = batchTasks.value[currentTaskIndex.value];
  task.status = "skipped";

  skippedVideos.value.push({
    name: task.name,
    reason: "用户手动跳过",
  });

  currentTaskIndex.value++;
  await processCurrentTask();
}
</script>

<style scoped>
.remove-ending {
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
