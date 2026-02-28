# MP4Handler 项目速览与开发规范（合并版）

> 目的：沉淀一次性阅读结果，后续开发优先参考本文件，减少重复扫项目成本。  
> 最后整理：2026-02-27

## 1. 项目定位

- 项目是一个 `Quasar + Electron` 的本地视频工作流平台。
- 核心能力：
  - 可视化工作流编辑（蓝图/代码双视图）
  - 工作流运行与任务调度
  - 视频处理（下载、拆解、拼接、去结尾等）
  - 人工交互节点（`waiting_input` 后继续）

## 2. 当前代码状态（阅读时）

- 分支：`main`
- Git 状态：工作区干净，`main` 相对远端 `ahead 1`
- 已存在大型文件（后续建议拆分）：
  - `src-electron/mp4handler-backend.ts`（3438 行）
  - `src/pages/WorkflowEditorPage.vue`（1239 行）
  - `src/components/workflow/TaskManager.vue`（914 行）
  - `src/components/workflow/WorkflowBlueprintEditor.vue`（876 行）

## 3. 技术栈与运行命令

### 3.1 技术栈

- 前端：Vue 3 + Quasar + TypeScript
- 桌面端：Electron
- 状态/辅助：Pinia、Vue Router、Vue I18n、Vue Flow
- 本地存储：`electron-store`
- 媒体工具：`ffmpeg` / `ffprobe`（内置二进制 + 系统回退）

### 3.2 常用命令

- 开发启动：`yarn dev`（等价 `quasar dev -m electron`）
- 构建 Windows：`yarn production:build_win`
- 构建 macOS：`yarn production:build_osx`

## 4. 目录与模块地图

### 4.1 前端目录（`src`）

- `src/pages/IndexPage.vue`：主入口页（工作流管理 + 任务管理）
- `src/pages/WorkflowEditorPage.vue`：工作流编辑器（视觉画布/看板/代码）
- `src/components/workflow/WorkflowManager.vue`：工作流列表、复制、删除、还原
- `src/components/workflow/TaskManager.vue`：任务列表、详情、进度图、日志、人工恢复
- `src/components/workflow/WorkflowBlueprintEditor.vue`：Comfy 风格节点画布
- `src/components/workflow/ComfyNode.vue`：节点卡片与节点内参数编辑
- `src/api/workflow-api.ts`：工作流 IPC API 封装
- `src/api/task-api.ts`：任务 IPC API 封装
- `src/shared/workflow-node-macros.ts`：节点宏/端口语义单一真源
- `src/tauri-compat/*`：Electron bridge 兼容层（invoke/event/dialog）

### 4.2 Electron 与后端目录（`src-electron`）

- `src-electron/electron-main.ts`：窗口管理、协议注册、IPC 注册
- `src-electron/electron-preload.ts`：`window.mp4handler` 能力暴露
- `src-electron/mp4handler-backend.ts`：命令路由、默认工作流、任务生命周期、媒体能力
- `src-electron/backend/domain/graph/*`：图规范化、运行前校验、图执行器、节点执行器
- `src-electron/backend/infra/store/workflow-store.ts`：工作流/任务索引持久化
- `src-electron/backend/infra/runtime/task-runtime-store.ts`：任务运行时快照持久化

## 5. 核心运行链路

1. 编辑器保存工作流  
   前端调用 `workflow:create` / `workflow:update`。
2. 运行工作流  
   前端调用 `workflow:run`，后端创建任务 + 运行目录 + runtime 文件。
3. 图执行  
   `executeTask` -> `executeWorkflowGraph` -> `executeGraphNode`（按 DAG 拓扑执行）。
4. 节点暂停等待人工输入  
   返回 `wait` 后任务状态进入 `waiting_input`，前端显示红点与表单。
5. 人工恢复  
   前端提交 `task:resume`，后端继续从 pending 节点向下执行。
6. 状态与日志同步  
   通过 `task:update` / `task:log` / `task:progress` / `task:removed` 事件推送。

## 6. 关键 IPC 命令（现行）

### 6.1 工作流

- `workflow:list`
- `workflow:get`
- `workflow:validate`
- `workflow:create`
- `workflow:update`
- `workflow:delete`
- `workflow:duplicate`
- `workflow:restore-default`
- `workflow:restore-all-default`
- `workflow:run`

### 6.2 任务

- `task:subscribe`
- `task:list`
- `task:get`
- `task:cancel`
- `task:resume`
- `task:remove`
- `task:clear-completed`

## 7. 默认内置工作流（系统工作流）

- `system-batch-download`（批量下载）
- `system-video-concat`（视频拼接）
- `system-remove-ending`（去结尾）
- `system-auto-split`（自动拆解）
- `system-auto-split-concat`（自动拆解并拼接）
- `system-download-auto-split`（下载并自动拆解）

说明：系统工作流支持编辑与保存，同时支持“还原默认”。

## 8. 数据与状态模型速记

- 工作流图：`WorkflowGraph = { nodes[], edges[] }`
- 任务状态：`queued -> running -> waiting_input -> running -> completed`
- 异常状态：`failed`、`canceled`
- 任务详情返回：`task + logs + interactionRequest + workflowGraph + graphProgress`

## 9. 开发规范（合并自 `DEVELOPMENT_RULES.md`）

### 9.1 节点系统规范

- 节点是全局性质：同一 `node type` 在所有工作流端口定义必须一致。
- 节点模板集中维护，前后端都依赖同一套定义。
- 旧工作流加载时必须做规范化，保证显示与运行一致。

### 9.2 节点宏定义单一真源

- 单一真源文件：`src/shared/workflow-node-macros.ts`
- 包含：
  - `PORT_VALUE_TYPES`
  - `WORKFLOW_NODE_MACROS`
  - `WORKFLOW_NODE_PORT_TEMPLATES`
- 前端编辑器与后端执行器都必须消费这份定义。

### 9.3 目录与抽象

- 后端分层：`shared` / `infra` / `domain`
- 前端分层：`api` / `features` / `shared`
- 原则上业务文件不超过 800 行，超出需拆分。
- 旧实现先迁移 `legacy` 再删除，避免回归。

### 9.4 端口与连线约束

- 端口必须声明业务语义类型（不是 JS 基础类型）。
- 前端编辑期与后端运行前都要进行连线校验。
- 不兼容连线必须拒绝或剔除，并给出可读错误。

### 9.5 配置与交互

- 节点参数优先放节点内部（Comfy 风格）。
- 运行前校验失败要直接提示具体节点与缺失项。
- 输入/输出目录等必填项未配置时禁止运行。

### 9.6 工作流管理

- 工作流名称唯一：`trim + 大小写不敏感`
- 内置工作流可编辑可保存，并支持还原默认
- 默认流程变更不强制覆盖用户修改（通过“还原默认”显式更新）

### 9.7 任务执行

- 严格状态机流转，`waiting_input` 是红点唯一来源。
- 多任务并发必须上下文隔离、日志隔离、运行目录隔离。
- 节点涉及临时文件时，成功/失败都应做清理。

### 9.8 持久化与兼容

- 使用 `electron-store` 存工作流与任务索引。
- 结构变更必须提供迁移策略或兼容处理。

### 9.9 提交前最小检查

- `yarn tsc --noEmit`
- `npx quasar build -m electron --skip-pkg`
- 至少验证：可保存/可运行、连线约束有效、默认流程可闭环执行

## 10. 新增规范（本次补充）

- **新增/修改节点类型时，必须同步更新以下 5 处：**
  1. `src/shared/workflow-node-macros.ts`（端口与语义定义）
  2. `src/components/workflow/ComfyNode.vue`（节点内配置 UI）
  3. `src/pages/WorkflowEditorPage.vue`（看板配置映射 `NODE_BOARD_SCHEMAS`）
  4. `src-electron/backend/domain/graph/node-execution.ts` 或 `nodes/*.node.ts`（执行逻辑）
  5. `src-electron/backend/domain/graph/graph-schema.ts`（运行前校验）

## 11. 下次快速阅读建议（5 分钟）

1. 先看本文件。
2. 再看 `src/shared/workflow-node-macros.ts`（端口语义）。
3. 看 `src/pages/WorkflowEditorPage.vue`（编辑器行为）。
4. 看 `src-electron/mp4handler-backend.ts` 的 `invokeMp4Command`（命令入口）。
5. 看 `backend/domain/graph`（执行与校验）。

