<template>
  <div class="batch-download">
    <q-card flat bordered>
      <q-card-section>
        <div class="text-h5 q-mb-md">
          <q-icon name="download" color="primary" size="sm" class="q-mr-sm" />
          批量下载
        </div>

        <q-form class="q-gutter-md">
          <q-input
            v-model="urlsText"
            type="textarea"
            label="视频 URL 列表"
            outlined
            rows="10"
            hint="每行一个 URL，支持回车分隔"
            :disable="isDownloading"
          >
            <template v-slot:prepend>
              <q-icon name="link" />
            </template>
          </q-input>

          <q-input
            v-model="outputDir"
            label="输出目录"
            readonly
            outlined
            :disable="isDownloading"
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
                @click="selectOutputDir"
                :disable="isDownloading"
              >
                <q-tooltip>选择文件夹</q-tooltip>
              </q-btn>
            </template>
          </q-input>

          <q-btn
            label="开始下载"
            color="primary"
            size="lg"
            icon="play_arrow"
            class="full-width"
            @click="startDownload"
            :disable="isDownloading || !outputDir || !urlsText.trim()"
            :loading="isDownloading"
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

    <!-- 下载任务列表 -->
    <q-card v-if="downloadTasks.length > 0" flat bordered class="q-mt-md">
      <q-card-section>
        <div class="text-h6 q-mb-md">
          <q-icon name="list" color="primary" class="q-mr-sm" />
          下载任务 ({{ completedCount }}/{{ downloadTasks.length }})
        </div>

        <q-list bordered separator>
          <q-item v-for="(task, index) in downloadTasks" :key="index">
            <q-item-section avatar>
              <q-icon
                :name="getStatusIcon(task.status)"
                :color="getStatusColor(task.status)"
              />
            </q-item-section>

            <q-item-section>
              <q-item-label>{{ task.filename }}</q-item-label>
              <q-item-label caption class="ellipsis">{{ task.url }}</q-item-label>
              <q-linear-progress
                v-if="task.status === 'downloading'"
                :value="task.progress / 100"
                color="primary"
                class="q-mt-sm"
              />
            </q-item-section>

            <q-item-section side>
              <q-item-label>{{ task.speed }}</q-item-label>
              <q-item-label caption>{{ task.progress }}%</q-item-label>
            </q-item-section>
          </q-item>
        </q-list>
      </q-card-section>
    </q-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";

interface DownloadTask {
  url: string;
  filename: string;
  status: 'pending' | 'downloading' | 'completed' | 'failed';
  progress: number;
  speed: string;
  error?: string;
}

const urlsText = ref("");
const outputDir = ref("");
const downloadTasks = ref<DownloadTask[]>([]);
const isDownloading = ref(false);
const error = ref("");

const completedCount = computed(() => {
  return downloadTasks.value.filter(t => t.status === 'completed').length;
});

// 监听下载进度
listen("download_progress", (event) => {
  const payload = event.payload as {
    url: string;
    progress: number;
    speed: string;
    status: string;
  };

  const task = downloadTasks.value.find(t => t.url === payload.url);
  if (task) {
    task.progress = payload.progress;
    task.speed = payload.speed;
    task.status = payload.status as any;
  }
});

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

function extractFilename(url: string): string {
  return url.split('/')
    .pop()
    ?.split('?')[0] || 'download.mp4';
}

async function startDownload() {
  error.value = "";

  // 解析 URL 列表
  const urls = urlsText.value
    .split('\n')
    .map(url => url.trim())
    .filter(url => url.length > 0);

  if (urls.length === 0) {
    error.value = "请输入至少一个 URL";
    return;
  }

  if (!outputDir.value) {
    error.value = "请选择输出目录";
    return;
  }

  // 创建下载任务
  downloadTasks.value = urls.map(url => ({
    url,
    filename: extractFilename(url),
    status: 'pending',
    progress: 0,
    speed: '0 MB/s'
  }));

  isDownloading.value = true;

  try {
    const result = await invoke<string>("batch_download", {
      urls,
      outputDir: outputDir.value,
      maxConcurrent: 3
    });

    alert(result);
  } catch (err) {
    error.value = String(err);
  } finally {
    isDownloading.value = false;
  }
}

function getStatusIcon(status: string): string {
  switch (status) {
    case 'pending': return 'schedule';
    case 'downloading': return 'downloading';
    case 'completed': return 'check_circle';
    case 'failed': return 'error';
    default: return 'help';
  }
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'pending': return 'grey';
    case 'downloading': return 'primary';
    case 'completed': return 'positive';
    case 'failed': return 'negative';
    default: return 'grey';
  }
}
</script>

<style scoped>
.batch-download {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 20px;
}

.ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
