<template>
  <main class="container">
    <!-- 左右布局 -->
    <div class="layout">
      <!-- 左侧 Tab 导航 -->
      <div class="tab-sidebar">
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
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'batch-split' }"
          @click="activeTab = 'batch-split'"
        >
          批量拆解
        </button>
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'auto-split' }"
          @click="activeTab = 'auto-split'"
        >
          自动拆解
        </button>
      </div>

      <!-- 右侧内容区域 -->
      <div class="content-area">
        <!-- 视频拼接 -->
        <div v-show="activeTab === 'concat'" class="tab-content">
          <VideoConcat />
        </div>

        <!-- 视频拆解 -->
        <div v-show="activeTab === 'split'" class="tab-content">
          <SingleSplit />
        </div>

        <!-- 批量拆解 -->
        <div v-show="activeTab === 'batch-split'" class="tab-content">
          <BatchSplit />
        </div>

        <!-- 自动拆解 -->
        <div v-show="activeTab === 'auto-split'" class="tab-content">
          <AutoSplit />
        </div>
      </div>
    </div>
  </main>
</template>

<script setup lang="ts">
import { ref } from "vue";
import VideoConcat from "./components/VideoConcat.vue";
import SingleSplit from "./components/SingleSplit.vue";
import BatchSplit from "./components/BatchSplit.vue";
import AutoSplit from "./components/AutoSplit.vue";

const activeTab = ref<'concat' | 'split' | 'batch-split' | 'auto-split'>('concat');
</script>

<style>
/* CSS 初始化 - 全局样式 */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}
</style>

<style scoped>
.container {
  max-width: 100%;
  height: 100vh;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

/* 左右布局 */
.layout {
  display: flex;
  height: 100%;
  overflow: hidden;
}

/* 左侧 Tab 栏 */
.tab-sidebar {
  width: 150px;
  background-color: #f5f5f5;
  border-right: 1px solid #ddd;
  display: flex;
  flex-direction: column;
  padding: 10px 0;
  flex-shrink: 0;
}

.tab-sidebar .tab-btn {
  width: 100%;
  padding: 15px 20px;
  border: none;
  background-color: transparent;
  color: #666;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  text-align: left;
  transition: all 0.2s;
  border-left: 3px solid transparent;
}

.tab-sidebar .tab-btn:hover {
  background-color: #e8e8e8;
  color: #333;
}

.tab-sidebar .tab-btn.active {
  color: #396cd8;
  background-color: #e7f3ff;
  border-left-color: #396cd8;
}

/* 右侧内容区域 */
.content-area {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  min-width: 0;
}

.tab-content {
  display: flex;
  flex-direction: column;
  height: 100%;
}

@media (prefers-color-scheme: dark) {
  .tab-sidebar {
    background-color: #1f1f1f;
    border-right-color: #444;
  }

  .tab-sidebar .tab-btn {
    color: #aaa;
  }

  .tab-sidebar .tab-btn:hover {
    background-color: #2f2f2f;
    color: #ddd;
  }

  .tab-sidebar .tab-btn.active {
    color: #64b5f6;
    background-color: #1a3a52;
    border-left-color: #64b5f6;
  }
}
</style>
