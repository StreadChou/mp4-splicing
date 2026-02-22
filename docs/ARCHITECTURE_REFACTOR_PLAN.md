# MP4Handler 目录与抽象重构规划（v1）

> 目标：解决 `src-electron/mp4handler-backend.ts` 过度集中（4000+ 行）与 `src` 侧组件逻辑耦合问题，建立可扩展的蓝图引擎架构。

## 1. 当前问题

- 后端单文件过大：`src-electron/mp4handler-backend.ts` 同时承载 IPC 分发、工作流存储、任务状态机、图执行器、节点执行、FFmpeg 能力。
- 前端页面/组件业务逻辑分散，`invoke` 调用散落在多个组件中，缺少统一 API 与状态抽象。
- 旧组件仍在仓库中（历史页面逻辑），增加认知噪音与维护成本。

## 2. 重构目标

- 分层明确：`UI -> 应用服务 -> 领域模型 -> 基础设施`。
- 节点机制统一：节点宏定义为单一真源，前后端共享。
- 节点执行解耦：每个节点单文件处理，避免超长 `if/else`。
- 存储与运行时分离：工作流数据、任务索引、运行时快照明确边界。
- 保持现有功能不回退：3 个默认工作流可跑通、可编辑、可恢复默认。

## 2.1 当前执行进度（持续更新）

- 已完成：
  - [x] 后端共享类型抽离（`backend/shared/types.ts`）
  - [x] 工作流/任务 store 抽离（`backend/infra/store/workflow-store.ts`）
  - [x] 任务 runtime 快照抽离（`backend/infra/runtime/task-runtime-store.ts`）
  - [x] 图规范化与图校验抽离（`backend/domain/graph/graph-schema.ts`）
  - [x] 图执行器抽离（`backend/domain/graph/graph-executor.ts`）
  - [x] 节点执行主逻辑抽离（`backend/domain/graph/node-execution.ts`）
  - [x] 节点执行初步分治（`backend/domain/graph/nodes/network.node.ts`、`backend/domain/graph/nodes/video.node.ts`）
  - [x] 前端 API 封装层建立并接入主要页面（`src/api/workflow-api.ts`、`src/api/task-api.ts`）
- 进行中：
  - [ ] 节点执行器细分（`nodes/*`）
  - [ ] Electron main 入口拆分（window/protocol/ipc）
  - [ ] 前端 `features` 目录化与 legacy 清理

## 3. 目标目录结构

```text
src-electron/
  main/
    index.ts                      # Electron 启动入口（原 electron-main.ts）
    windows/
      main-window.ts
      workflow-editor-window.ts
    protocols/
      local-file-protocol.ts
    ipc/
      index.ts                    # 注册所有 IPC
      workflow.ipc.ts
      task.ipc.ts
      dialog.ipc.ts
      ui.ipc.ts

  backend/
    index.ts                      # invoke 统一路由
    shared/
      types.ts                    # 后端领域类型（Workflow/Task/Graph）
      constants.ts
      errors.ts
      result.ts
    infra/
      store/
        workflow-store.ts         # electron-store 读写
      runtime/
        task-runtime-store.ts     # runtime json 快照
      media/
        ffmpeg.ts
        ffprobe.ts
      fs/
        path-utils.ts
        cleanup.ts
      events/
        task-bus.ts               # task:update/task:log 广播
    domain/
      workflow/
        workflow-service.ts       # list/get/create/update/delete/duplicate/restore
        default-workflows.ts
        name-policy.ts
      task/
        task-service.ts           # create/get/list/cancel/resume
        task-status-machine.ts
      graph/
        graph-normalizer.ts       # 端口归一化
        graph-validator.ts        # 节点/连线/类型校验
        graph-executor.ts         # DAG 执行
        node-input-resolver.ts
        node-output-normalizer.ts
        node-runner.ts            # 节点分发器
        nodes/
          input-dir.node.ts
          output-dir.node.ts
          user-input.node.ts
          text-split.node.ts
          file-read.node.ts
          network-batch-download.node.ts
          video-auto-split.node.ts
          control.node.ts
          human.node.ts
          io.node.ts
      media/
        concat-service.ts
        auto-split-service.ts
        segment-service.ts
        remove-ending-service.ts
        similarity-service.ts

src/
  app/
    router/
    layout/
  shared/
    workflow-node-macros.ts       # 已存在，继续作为前后端单一真源
    types/
    utils/
  api/
    workflow-api.ts               # invoke 封装
    task-api.ts
    system-api.ts
  features/
    workflow-management/
      components/
      composables/
      pages/
    workflow-editor/
      components/
        editor-shell/
        palette-panel/
        graph-canvas/
        inspector-panel/
        code-view/
      composables/
        use-workflow-editor.ts
        use-graph-sync.ts
        use-connection-guard.ts
      pages/
    task-management/
      components/
      composables/
      pages/
  legacy/                         # 过渡期：旧组件临时迁移区（最终删除）
```

## 4. 核心抽象建议

### 4.1 节点执行抽象（后端）

- `INodeExecutor`：
  - `canRun(node): boolean`
  - `validate(node, payload): ValidationIssue[]`
  - `run(ctx): Promise<NodeExecutionResult>`
- `NodeExecutionContext`：
  - `task`, `node`, `payload`, `runtime`, `services`, `logger`
- `NodeExecutionResult`：
  - `kind: "output" | "wait"`
  - `output` / `interaction`
- 所有节点执行器统一通过 `node-runner.ts` 注册与分发。

### 4.2 临时文件生命周期（后端）

- 新增 `TempResourceScope`（或 `withTempScope`）：
  - `register(path)` 注册临时目录/文件
  - `dispose()` 在 `finally` 中统一清理
- 节点或媒体服务中禁止裸用 `os.tmpdir()` 且不清理。

### 4.3 API 边界（前端）

- 禁止组件直接 `invoke("workflow:*")`；统一走 `src/api/*`。
- 业务状态集中在 `composables`，组件只负责展示和事件。

## 5. 前端组件拆分建议（先拆这两个大件）

- `WorkflowBlueprintEditor.vue`（800+ 行）拆分为：
  - `EditorToolbar.vue`
  - `NodePalette.vue`
  - `GraphCanvas.vue`
  - `InspectorPanel.vue`
  - `useBlueprintEditor.ts`（连线校验、图同步、键盘操作）
- `TaskManager.vue` 拆分为：
  - `TaskListPane.vue`
  - `TaskDetailPane.vue`
  - `InteractionForm.vue`
  - `useTaskManager.ts`

## 6. 旧文件清理建议（分阶段）

- 可删除候选（未被当前路由使用）：
  - `src/components/AutoSplit.vue`
  - `src/components/BatchDownload.vue`
  - `src/components/BatchSplit.vue`
  - `src/components/RemoveEnding.vue`
  - `src/components/SingleSplit.vue`
  - `src/components/VideoConcat.vue`
  - `src/components/VideoSplitter.vue`
  - `src/components/ExampleComponent.vue`
  - `src/components/EssentialLink.vue`
  - `src/layouts/MainLayout.vue`
  - `src/stores/example-store.ts`

> 建议先移动到 `src/legacy/` 观察 1 个版本，再物理删除。

## 7. 迁移顺序（建议）

1. 提取共享类型与节点执行接口（不改行为）。
2. 拆 `mp4handler-backend.ts`：先拆 `infra` 与 `domain/workflow`。
3. 拆图执行器与节点执行器（每次只迁移 1~2 个节点）。
4. 前端引入 `api` 层，替换直接 `invoke`。
5. 拆 `WorkflowBlueprintEditor` 与 `TaskManager`。
6. 迁移并清理 legacy 组件。

## 8. 验收标准

- `src-electron` 无单文件超过 800 行（允许少量例外）。
- 节点新增只需新增一个执行器文件 + 宏定义，不改核心执行循环。
- 前端页面中不直接出现 `invoke("workflow:*")` / `invoke("task:*")`。
- 构建与类型检查通过，三个默认工作流完整可用。
