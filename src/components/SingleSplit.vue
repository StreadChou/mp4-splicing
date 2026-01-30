<template>
  <div class="single-split">
    <q-card flat bordered class="q-mb-md">
      <q-card-section>
        <div class="text-h5 q-mb-md">
          <q-icon name="content_cut" color="primary" size="sm" class="q-mr-sm" />
          视频拆解
        </div>

        <q-input
          v-model="splitVideoFile"
          label="选择视频文件"
          readonly
          outlined
          :disable="isLoadingMetadata || isGeneratingSegments"
          hint="选择要拆解的 MP4 视频文件"
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
              @click="selectSplitVideoFile"
              :disable="isLoadingMetadata || isGeneratingSegments"
            >
              <q-tooltip>选择视频</q-tooltip>
            </q-btn>
          </template>
        </q-input>
      </q-card-section>
    </q-card>

    <VideoSplitter
      v-if="splitVideoFile"
      ref="splitterRef"
      :video-metadata="videoMetadata"
      :all-frames="allFrames"
      :is-loading-frames="isLoadingFrames"
      :frame-progress="frameProgress"
      :frame-progress-msg="frameProgressMsg"
      :is-generating-segments="isGeneratingSegments"
      :segment-progress="segmentProgress"
      :progress-msg="progressMsg"
      :error="splitError"
      @generate="handleGenerate"
    />

    <!-- 输出设置 -->
    <q-card v-if="splitterRef?.selectedSegments && splitterRef.selectedSegments.length > 0" flat bordered class="q-mt-md">
      <q-card-section>
        <q-input
          v-model="splitOutputDir"
          label="输出目录（可选）"
          readonly
          outlined
          :disable="isGeneratingSegments"
          hint="默认为视频所在目录"
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
              @click="selectSplitOutputDir"
              :disable="isGeneratingSegments"
            >
              <q-tooltip>选择目录</q-tooltip>
            </q-btn>
          </template>
        </q-input>
      </q-card-section>
    </q-card>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
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

const splitVideoFile = ref("");
const videoMetadata = ref<VideoMetadata | null>(null);
const allFrames = ref<FrameInfo[]>([]);
const isLoadingMetadata = ref(false);
const isLoadingFrames = ref(false);
const isGeneratingSegments = ref(false);
const frameProgress = ref(0);
const frameProgressMsg = ref("");
const segmentProgress = ref(0);
const progressMsg = ref("");
const splitError = ref("");
const splitOutputDir = ref("");
const splitterRef = ref<InstanceType<typeof VideoSplitter> | null>(null);

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

// 选择视频文件进行拆解
async function selectSplitVideoFile() {
  const selected = await open({
    directory: false,
    multiple: false,
    title: "选择视频文件",
    filters: [
      {
        name: "视频文件",
        extensions: ["mp4"],
      },
    ],
  });
  if (selected) {
    splitVideoFile.value = selected as string;
    await loadVideoMetadata();
  }
}

// 加载视频元数据和所有帧
async function loadVideoMetadata() {
  splitError.value = "";
  isLoadingMetadata.value = true;
  frameProgress.value = 0;
  frameProgressMsg.value = "";

  try {
    videoMetadata.value = await invoke<VideoMetadata>("get_video_metadata", {
      videoPath: splitVideoFile.value,
    });

    isLoadingFrames.value = true;
    allFrames.value = await invoke<FrameInfo[]>("extract_all_frames", {
      videoPath: splitVideoFile.value,
    });
  } catch (error) {
    splitError.value = String(error);
  } finally {
    isLoadingMetadata.value = false;
    isLoadingFrames.value = false;
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

// 生成视频片段
async function handleGenerate(segments: SegmentRange[]) {
  if (segments.length === 0) {
    splitError.value = "请至少选择一个片段";
    return;
  }

  isGeneratingSegments.value = true;
  segmentProgress.value = 0;
  splitError.value = "";

  try {
    const outputDir = splitOutputDir.value ||
      splitVideoFile.value.substring(0, splitVideoFile.value.lastIndexOf("/"));

    const result = await invoke<string>("generate_video_segments", {
      videoPath: splitVideoFile.value,
      segments,
      outputDir,
    });
    alert(result);
  } catch (error) {
    splitError.value = String(error);
  } finally {
    isGeneratingSegments.value = false;
  }
}
</script>

<style scoped>
.single-split {
  display: flex;
  flex-direction: column;
  height: 100%;
}
</style>
