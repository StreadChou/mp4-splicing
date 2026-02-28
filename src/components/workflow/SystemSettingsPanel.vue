<template>
  <q-card flat bordered class="settings-card">
    <q-card-section class="row items-center q-gutter-sm">
      <div class="text-h6 text-weight-medium">系统设置</div>
      <q-space />
      <q-btn flat dense round icon="refresh" :disable="loading" @click="loadSettings">
        <q-tooltip>刷新设置</q-tooltip>
      </q-btn>
    </q-card-section>

    <q-separator />

    <q-card-section>
      <q-banner rounded dense class="bg-teal-1 text-teal-10 q-mb-md">
        临时目录用于逐帧拆解等中间文件。未手动设置时默认使用系统临时目录，并按用途自动创建子目录。
      </q-banner>

      <q-input
        v-model="tempRootDir"
        outlined
        label="临时文件目录地址"
        :disable="loading || saving"
        hint="建议使用本地磁盘目录，例如: /Volumes/Data/mp4handler-temp"
      >
        <template #append>
          <q-btn
            flat
            round
            dense
            icon="folder_open"
            :disable="loading || saving"
            @click="pickTempRootDir"
          />
        </template>
      </q-input>

      <div class="text-caption text-grey-5 q-mt-sm">
        当前会使用以下子目录：
      </div>
      <ul class="settings-subdir text-caption text-grey-4 q-mt-xs">
        <li><code>frame_extract/</code>：视频逐帧提取临时文件</li>
        <li><code>split_compose_per_video/</code>：单视频拆解并重组临时文件</li>
      </ul>

      <div class="row q-gutter-sm q-mt-md">
        <q-btn
          color="primary"
          icon="save"
          label="保存设置"
          :loading="saving"
          :disable="loading"
          @click="saveSettings"
        />
        <q-btn
          flat
          icon="restart_alt"
          label="恢复默认目录"
          :disable="loading || saving"
          @click="resetToDefault"
        />
      </div>

      <q-banner v-if="errorMsg" rounded class="bg-negative text-white q-mt-md">
        {{ errorMsg }}
      </q-banner>
      <q-banner v-else-if="successMsg" rounded class="bg-positive text-white q-mt-md">
        {{ successMsg }}
      </q-banner>
    </q-card-section>
  </q-card>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { open as openDialog } from "src/tauri-compat/dialog";
import { getAppSettings, updateAppSettings } from "src/api/settings-api";

const loading = ref(false);
const saving = ref(false);
const tempRootDir = ref("");
const errorMsg = ref("");
const successMsg = ref("");

async function loadSettings() {
  loading.value = true;
  errorMsg.value = "";
  successMsg.value = "";
  try {
    const settings = await getAppSettings();
    tempRootDir.value = settings.tempRootDir;
  } catch (error) {
    errorMsg.value = String(error);
  } finally {
    loading.value = false;
  }
}

async function pickTempRootDir() {
  errorMsg.value = "";
  successMsg.value = "";
  try {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: "选择临时文件目录",
    });
    if (typeof selected === "string" && selected.trim()) {
      tempRootDir.value = selected;
    }
  } catch (error) {
    errorMsg.value = `选择目录失败: ${String(error)}`;
  }
}

async function saveSettings() {
  const nextDir = tempRootDir.value.trim();
  if (!nextDir) {
    errorMsg.value = "临时目录不能为空";
    return;
  }

  saving.value = true;
  errorMsg.value = "";
  successMsg.value = "";
  try {
    const saved = await updateAppSettings({ tempRootDir: nextDir });
    tempRootDir.value = saved.tempRootDir;
    successMsg.value = "系统设置已保存";
  } catch (error) {
    errorMsg.value = String(error);
  } finally {
    saving.value = false;
  }
}

async function resetToDefault() {
  saving.value = true;
  errorMsg.value = "";
  successMsg.value = "";
  try {
    const saved = await updateAppSettings({ tempRootDir: "" });
    tempRootDir.value = saved.tempRootDir;
    successMsg.value = "已恢复默认目录";
  } catch (error) {
    errorMsg.value = String(error);
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  void loadSettings();
});
</script>

<style scoped>
.settings-card {
  min-height: calc(100vh - 120px);
  background: rgba(255, 255, 255, 0.84);
  border-color: rgba(9, 91, 85, 0.15);
  color: #15423f;
}

.settings-subdir {
  margin: 0;
  padding-left: 16px;
}

.settings-subdir code {
  color: #0e9488;
}
</style>
