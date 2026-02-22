# MP4Handler 开发规范（项目级）

> 本规范用于约束蓝图工作流、节点系统、执行引擎与 UI 的后续开发，避免功能回退与行为不一致。

## 1. 节点系统规范

- **节点是全局性质的**：同一 `node type`（如 `video`、`network`、`file`）在每个工作流中必须保持一致的输入/输出端口定义，不允许“同名节点在不同工作流端口数量不同”。
- 节点模板应集中维护（单一真源），前端编辑器与后端执行器都必须读取同一套端口规范。
- 旧工作流加载时应做规范化（端口自动对齐模板），保证显示与运行一致。

## 2. 节点宏定义（单一真源）

- 宏定义文件：`src/shared/workflow-node-macros.ts`
- 关键宏：
  - `PORT_VALUE_TYPES`：端口业务语义类型枚举
  - `WORKFLOW_NODE_MACROS`：节点定义总表（类型/端口/语义说明）
  - `WORKFLOW_NODE_PORT_TEMPLATES`：节点端口模板（用于运行时规范化）
- 消费位置：
  - 前端编辑器：`src/components/workflow/WorkflowBlueprintEditor.vue`
  - 后端执行器：`src-electron/mp4handler-backend.ts`
- 当前已登记节点（遍历结果）：
  - 可视化节点：`input_dir`、`output_dir`、`user_input`、`text_split`、`file`、`network`、`video`、`control`、`custom`
  - 运行时保留节点：`human`、`io`（默认不在节点库展示）

## 3. 目录与抽象规范

- 目录重构规划文档：`docs/ARCHITECTURE_REFACTOR_PLAN.md`
- 后端目录分层要求（`src-electron`）：
  - `backend/shared`：领域类型、常量、错误定义
  - `backend/infra`：存储、文件系统、媒体适配、事件总线
  - `backend/domain`：工作流、任务、图执行与节点执行器
- 前端目录分层要求（`src`）：
  - `api`：统一 IPC 调用封装（组件禁止直接调用 `invoke("workflow:*")` / `invoke("task:*")`）
  - `features`：按业务模块组织页面/组件/composables
  - `shared`：跨模块共享类型、宏定义、工具
- 单文件体积约束：原则上业务文件不超过 800 行；超出必须拆分（临时过渡文件除外）。
- 旧实现迁移规则：先迁移到 `legacy` 过渡目录，确认无引用后再删除，避免误删回归。

## 4. 端口与连线约束

- **节点的出入端点必须约束好入参/出参类型，不可随意连线。**
- 每个端口必须有明确的**业务语义类型**（不是 JS 基础类型），例如：
  - `AbsolutePath`（绝对路径）
  - `AbsolutePathList`（绝对路径数组）
  - `UrlTextBlock`（多行 URL 文本）
  - `UrlList`（URL 数组）
  - `CompletionSignal`（完成信号）
- 节点端口类型由节点协议统一定义，禁止在单个工作流里私自改端口类型或复用为其他含义。
- 连线校验必须同时在前端（编辑期）与后端（运行前）执行。
- 对不兼容连线（端口不存在、索引越界、语义类型不匹配）必须拒绝或自动剔除，并给出可读错误信息。

## 5. 配置与交互规范

- 节点可配置项应放在节点内部（ComfyUI 风格），属性面板仅用于文档说明（节点作用、输入/输出说明）。
- 运行不做二次确认；运行前校验失败时直接提示具体节点与缺失项。
- 必选目录节点（输入目录/输出目录）未配置时禁止运行。

## 6. 工作流管理规范

- 工作流名称必须唯一（`trim + 大小写不敏感`）。
- 内置工作流可编辑可保存，同时必须支持“还原默认”。
- 默认工作流变更后，不强制覆盖用户已修改内容；通过“还原默认”显式更新。

## 7. 任务执行规范

- 状态机：`queued -> running -> waiting_input -> running -> completed`，异常态：`failed`、`canceled`。
- `waiting_input` 是任务管理红点唯一来源，红点显示待人工任务数量。
- 多任务并发时，必须保证任务上下文隔离，日志与运行目录隔离。
- 若节点执行过程中创建了临时文件/临时目录，节点在结束（成功或失败）时必须执行清理，确保不遗留无用临时产物。

## 8. 持久化与兼容规范

- 使用 `electron-store` 存储工作流与任务索引，保留 `schemaVersion` 以支持迁移。
- 任何结构变更（节点端口、流程模板、任务快照）都需要提供迁移策略或兼容处理。

## 9. 提交前最小检查

- 类型检查通过：`yarn tsc --noEmit`
- Electron 构建通过：`npx quasar build -m electron --skip-pkg`
- 至少验证：
  - 工作流可保存/可运行
  - 连线受约束（错误连线被拦截）
  - 三个默认流程可闭环执行
