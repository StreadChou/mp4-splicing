<template>
  <q-layout view="hHh lpR fFf">
    <!-- 顶部标题栏 -->
    <q-header elevated class="bg-primary text-white">
      <q-toolbar>
        <q-toolbar-title>
          <q-icon name="video_library" size="sm" class="q-mr-sm" />
          MP4 视频处理工具
        </q-toolbar-title>
      </q-toolbar>
    </q-header>

    <!-- 左侧导航抽屉 -->
    <q-drawer
      :model-value="true"
      show-if-above
      :width="200"
      :breakpoint="0"
      bordered
      class="bg-grey-1"
    >
      <q-list padding>
        <q-item-label header class="text-weight-bold text-grey-8">
          功能菜单
        </q-item-label>

        <q-item
          clickable
          v-ripple
          :active="activeTab === 'concat'"
          @click="activeTab = 'concat'"
          active-class="bg-primary text-white"
          class="rounded-borders q-mb-xs"
        >
          <q-item-section avatar>
            <q-icon name="merge" />
          </q-item-section>
          <q-item-section>视频拼接</q-item-section>
        </q-item>

        <q-item
          clickable
          v-ripple
          :active="activeTab === 'split'"
          @click="activeTab = 'split'"
          active-class="bg-primary text-white"
          class="rounded-borders q-mb-xs"
        >
          <q-item-section avatar>
            <q-icon name="content_cut" />
          </q-item-section>
          <q-item-section>视频拆解</q-item-section>
        </q-item>

        <q-item
          clickable
          v-ripple
          :active="activeTab === 'batch-split'"
          @click="activeTab = 'batch-split'"
          active-class="bg-primary text-white"
          class="rounded-borders q-mb-xs"
        >
          <q-item-section avatar>
            <q-icon name="splitscreen" />
          </q-item-section>
          <q-item-section>批量拆解</q-item-section>
        </q-item>

        <q-item
          clickable
          v-ripple
          :active="activeTab === 'auto-split'"
          @click="activeTab = 'auto-split'"
          active-class="bg-primary text-white"
          class="rounded-borders q-mb-xs"
        >
          <q-item-section avatar>
            <q-icon name="auto_awesome" />
          </q-item-section>
          <q-item-section>自动拆解</q-item-section>
        </q-item>

        <q-item
          clickable
          v-ripple
          :active="activeTab === 'remove-ending'"
          @click="activeTab = 'remove-ending'"
          active-class="bg-primary text-white"
          class="rounded-borders q-mb-xs"
        >
          <q-item-section avatar>
            <q-icon name="cut" />
          </q-item-section>
          <q-item-section>去结尾</q-item-section>
        </q-item>

        <q-item
          clickable
          v-ripple
          :active="activeTab === 'batch-download'"
          @click="activeTab = 'batch-download'"
          active-class="bg-primary text-white"
          class="rounded-borders q-mb-xs"
        >
          <q-item-section avatar>
            <q-icon name="download" />
          </q-item-section>
          <q-item-section>批量下载</q-item-section>
        </q-item>
      </q-list>
    </q-drawer>

    <!-- 主内容区域 -->
    <q-page-container>
      <q-page padding>
        <div class="q-pa-md">
          <VideoConcat v-show="activeTab === 'concat'" />
          <SingleSplit v-show="activeTab === 'split'" />
          <BatchSplit v-show="activeTab === 'batch-split'" />
          <AutoSplit v-show="activeTab === 'auto-split'" />
          <RemoveEnding v-show="activeTab === 'remove-ending'" />
          <BatchDownload v-show="activeTab === 'batch-download'" />
        </div>
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import { ref } from "vue";
import VideoConcat from "./components/VideoConcat.vue";
import SingleSplit from "./components/SingleSplit.vue";
import BatchSplit from "./components/BatchSplit.vue";
import AutoSplit from "./components/AutoSplit.vue";
import RemoveEnding from "./components/RemoveEnding.vue";
import BatchDownload from "./components/BatchDownload.vue";

const activeTab = ref<'concat' | 'split' | 'batch-split' | 'auto-split' | 'remove-ending' | 'batch-download'>('concat');
</script>

