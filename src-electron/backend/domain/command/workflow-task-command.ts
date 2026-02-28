import crypto from "node:crypto";
import { normalizeWorkflowGraph, validateWorkflowGraphStructure, validateWorkflowRunConfig } from "../graph/graph-schema";
import type {
  TaskRuntimeSnapshot,
  WorkflowDefinition,
  WorkflowGraph,
  WorkflowMeta,
  WorkflowTaskRecord,
} from "../../shared/types";
import { WORKFLOW_SCHEMA_VERSION } from "../../shared/types";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string") {
        return item;
      }
    }
  }
  return "";
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item)).map((item) => item.trim()).filter(Boolean);
}

interface WorkflowTaskCommandContext {
  ensureDefaultWorkflows(): void;
  workflowToMeta(workflow: WorkflowDefinition): WorkflowMeta;
  getWorkflowById(workflowId: string): WorkflowDefinition;
  findSystemWorkflowDefinition(workflowId: string): WorkflowDefinition | undefined;
  createSystemWorkflowDefinitions(): WorkflowDefinition[];
  assertWorkflowNameUnique(name: string, ignoreWorkflowId?: string): void;
  normalizeWorkflowName(name: string): string;
  createEmptyGraph(): WorkflowGraph;
  createRunDir(workflowName: string): string;
  toIsoNow(): string;
  ensureDir(dirPath: string): Promise<void>;
  getWorkflowsFromStore(): WorkflowDefinition[];
  setWorkflowsToStore(workflows: WorkflowDefinition[]): void;
  getTasksFromStore(): WorkflowTaskRecord[];
  setTasksToStore(tasks: WorkflowTaskRecord[]): void;
  writeTaskRuntime(taskId: string, runtime: TaskRuntimeSnapshot): Promise<void>;
  readTaskRuntime(taskId: string): Promise<TaskRuntimeSnapshot>;
  deleteTaskRuntime(taskId: string): Promise<void>;
  tryFindTask(taskId: string): WorkflowTaskRecord | null;
  findTask(taskId: string): WorkflowTaskRecord;
  removeTaskFromStore(taskId: string): WorkflowTaskRecord | null;
  waitTaskLogQueue(taskId: string): Promise<void>;
  updateTask(taskId: string, patch: Partial<WorkflowTaskRecord>): WorkflowTaskRecord;
  appendTaskLog(
    taskId: string,
    message: string,
    level?: "info" | "error" | "warn",
    meta?: { nodeId?: string; nodeLabel?: string },
  ): Promise<void>;
  emitTaskBroadcast(event: string, payload: unknown): void;
  executeTask(taskId: string, resumePayload?: Record<string, unknown>): Promise<void>;
  removedTaskIds: Set<string>;
  taskLogQueues: Map<string, Promise<void>>;
}

export async function invokeWorkflowTaskCommand(
  command: string,
  args: Record<string, unknown>,
  ctx: WorkflowTaskCommandContext,
): Promise<unknown> {
  switch (command) {
    case "workflow:list": {
      ctx.ensureDefaultWorkflows();
      return ctx
        .getWorkflowsFromStore()
        .map(ctx.workflowToMeta)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }

    case "workflow:get": {
      const workflowId = asString(args.id);
      const workflow = ctx.getWorkflowById(workflowId);
      return {
        ...workflow,
        graph: normalizeWorkflowGraph(workflow.graph),
      };
    }

    case "workflow:validate": {
      const graph = normalizeWorkflowGraph(args.graph);
      const issues = validateWorkflowGraphStructure(graph);
      return {
        valid: issues.length === 0,
        issues,
      };
    }

    case "workflow:create": {
      ctx.ensureDefaultWorkflows();
      const name = asString(args.name).trim();
      if (!name) {
        throw new Error("工作流名称不能为空");
      }
      ctx.assertWorkflowNameUnique(name);

      const now = ctx.toIsoNow();
      const created: WorkflowDefinition = {
        id: crypto.randomUUID(),
        name,
        description: asString(args.description),
        source: "user",
        readonly: false,
        schemaVersion: WORKFLOW_SCHEMA_VERSION,
        systemKind: "custom",
        graph: normalizeWorkflowGraph(args.graph) || ctx.createEmptyGraph(),
        createdAt: now,
        updatedAt: now,
      };
      const workflows = ctx.getWorkflowsFromStore();
      workflows.push(created);
      ctx.setWorkflowsToStore(workflows);
      return created;
    }

    case "workflow:update": {
      ctx.ensureDefaultWorkflows();
      const workflowId = asString(args.id);
      const workflows = ctx.getWorkflowsFromStore();
      const index = workflows.findIndex((item) => item.id === workflowId);
      if (index < 0) {
        throw new Error("工作流不存在");
      }
      const target = workflows[index] as WorkflowDefinition;
      const nextName = asString(args.name).trim();
      if (!nextName) {
        throw new Error("工作流名称不能为空");
      }
      ctx.assertWorkflowNameUnique(nextName, workflowId);

      const updated: WorkflowDefinition = {
        ...target,
        name: nextName,
        description: asString(args.description),
        graph: normalizeWorkflowGraph(args.graph),
        systemKind: target.source === "system" ? target.systemKind : "custom",
        updatedAt: ctx.toIsoNow(),
      };
      workflows[index] = updated;
      ctx.setWorkflowsToStore(workflows);
      return updated;
    }

    case "workflow:delete": {
      ctx.ensureDefaultWorkflows();
      const workflowId = asString(args.id);
      const workflows = ctx.getWorkflowsFromStore();
      const target = workflows.find((item) => item.id === workflowId);
      if (!target) {
        throw new Error("工作流不存在");
      }
      if (target.source === "system") {
        throw new Error("内置工作流不可删除");
      }
      ctx.setWorkflowsToStore(workflows.filter((item) => item.id !== workflowId));
      return null;
    }

    case "workflow:restore-default": {
      ctx.ensureDefaultWorkflows();
      const workflowId = asString(args.id);
      const defaultDefinition = ctx.findSystemWorkflowDefinition(workflowId);
      if (!defaultDefinition) {
        throw new Error("仅支持还原内置工作流");
      }

      const workflows = ctx.getWorkflowsFromStore();
      const index = workflows.findIndex((item) => item.id === workflowId);
      const existing = index >= 0 ? (workflows[index] as WorkflowDefinition) : null;

      const restored: WorkflowDefinition = {
        ...defaultDefinition,
        createdAt: existing?.createdAt || defaultDefinition.createdAt,
        updatedAt: ctx.toIsoNow(),
      };

      if (index >= 0) {
        workflows[index] = restored;
      } else {
        workflows.push(restored);
      }
      ctx.setWorkflowsToStore(workflows);
      return restored;
    }

    case "workflow:restore-all-default": {
      ctx.ensureDefaultWorkflows();
      const now = ctx.toIsoNow();
      const systemDefinitions = ctx.createSystemWorkflowDefinitions();
      const workflowMap = new Map(ctx.getWorkflowsFromStore().map((item) => [item.id, item] as const));
      const restoredIds: string[] = [];

      for (const systemWorkflow of systemDefinitions) {
        const existing = workflowMap.get(systemWorkflow.id);
        const restored: WorkflowDefinition = {
          ...systemWorkflow,
          createdAt: existing?.createdAt || systemWorkflow.createdAt,
          updatedAt: now,
        };
        workflowMap.set(systemWorkflow.id, restored);
        restoredIds.push(systemWorkflow.id);
      }

      ctx.setWorkflowsToStore(Array.from(workflowMap.values()));
      return {
        restoredIds,
        count: restoredIds.length,
      };
    }

    case "workflow:duplicate": {
      ctx.ensureDefaultWorkflows();
      const workflowId = asString(args.id);
      const sourceWorkflow = ctx.getWorkflowById(workflowId);
      let nextName = asString(args.newName).trim();
      if (!nextName) {
        nextName = `${sourceWorkflow.name} 副本`;
      }
      if (
        ctx
          .getWorkflowsFromStore()
          .some((item) => ctx.normalizeWorkflowName(item.name) === ctx.normalizeWorkflowName(nextName))
      ) {
        let seq = 2;
        let candidate = `${nextName} ${String(seq)}`;
        while (
          ctx
            .getWorkflowsFromStore()
            .some((item) => ctx.normalizeWorkflowName(item.name) === ctx.normalizeWorkflowName(candidate))
        ) {
          seq += 1;
          candidate = `${nextName} ${String(seq)}`;
        }
        nextName = candidate;
      }
      ctx.assertWorkflowNameUnique(nextName);
      const now = ctx.toIsoNow();
      const duplicated: WorkflowDefinition = {
        ...sourceWorkflow,
        id: crypto.randomUUID(),
        name: nextName,
        source: "user",
        readonly: false,
        systemKind: "custom",
        createdAt: now,
        updatedAt: now,
      };
      const workflows = ctx.getWorkflowsFromStore();
      workflows.push(duplicated);
      ctx.setWorkflowsToStore(workflows);
      return duplicated;
    }

    case "workflow:run": {
      ctx.ensureDefaultWorkflows();
      const workflowId = asString(args.id);
      const workflow = ctx.getWorkflowById(workflowId);
      const runtimeInput = asRecord(args.runtimeInput);
      const graphOverride = args.graph !== undefined ? normalizeWorkflowGraph(args.graph) : null;
      const runtimeWorkflow: WorkflowDefinition = graphOverride
        ? {
            ...workflow,
            graph: graphOverride,
          }
        : {
            ...workflow,
            graph: normalizeWorkflowGraph(workflow.graph),
          };

      const issues = validateWorkflowRunConfig(runtimeWorkflow, runtimeInput);
      if (issues.length > 0) {
        throw new Error(`运行前检查失败:\n${issues.map((item) => `- ${item}`).join("\n")}`);
      }

      const taskId = crypto.randomUUID();
      ctx.removedTaskIds.delete(taskId);
      const runDir = ctx.createRunDir(runtimeWorkflow.name);
      await ctx.ensureDir(runDir);

      const task: WorkflowTaskRecord = {
        id: taskId,
        workflowId: runtimeWorkflow.id,
        workflowName: runtimeWorkflow.name,
        status: "queued",
        currentNodeId: "queued",
        createdAt: ctx.toIsoNow(),
        updatedAt: ctx.toIsoNow(),
        runDir,
        runtimeInput,
        waitingInteraction: null,
        workflowSnapshot: {
          id: runtimeWorkflow.id,
          name: runtimeWorkflow.name,
          source: runtimeWorkflow.source,
          systemKind: runtimeWorkflow.systemKind,
          graph: runtimeWorkflow.graph,
        },
      };

      const tasks = ctx.getTasksFromStore();
      tasks.push(task);
      ctx.setTasksToStore(tasks);

      await ctx.writeTaskRuntime(taskId, {
        phase: "",
        context: {},
        logs: [],
        interaction: null,
      });
      await ctx.appendTaskLog(taskId, `任务已创建，工作流: ${runtimeWorkflow.name}`);
      ctx.emitTaskBroadcast("task:update", task);

      void ctx.executeTask(taskId);
      return task;
    }

    case "task:subscribe": {
      return null;
    }

    case "task:list": {
      ctx.ensureDefaultWorkflows();
      return ctx.getTasksFromStore().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    case "task:get": {
      const taskId = asString(args.id);
      const task = ctx.findTask(taskId);
      const runtime = await ctx.readTaskRuntime(taskId);
      const workflowGraph = task.workflowSnapshot ? normalizeWorkflowGraph(task.workflowSnapshot.graph) : null;
      const rawGraphState = asRecord(runtime.context.graphState);
      const pendingNodeId = asString(rawGraphState.pendingNodeId || runtime.context.pendingNodeId);
      const executedNodeIds = Array.from(new Set(asStringArray(rawGraphState.executedNodeIds)));
      return {
        task,
        logs: runtime.logs,
        interactionRequest: runtime.interaction,
        workflowGraph,
        graphProgress: {
          phase: runtime.phase,
          executedNodeIds,
          pendingNodeId,
          totalNodes: workflowGraph?.nodes.length || 0,
        },
      };
    }

    case "task:cancel": {
      const taskId = asString(args.id);
      const task = ctx.findTask(taskId);
      if (task.status === "completed" || task.status === "failed" || task.status === "canceled") {
        return task;
      }
      const updated = ctx.updateTask(taskId, {
        status: "canceled",
        finishedAt: ctx.toIsoNow(),
        waitingInteraction: null,
      });
      const runtime = await ctx.readTaskRuntime(taskId);
      runtime.interaction = null;
      await ctx.writeTaskRuntime(taskId, runtime);
      await ctx.appendTaskLog(taskId, "任务已取消", "warn");
      return updated;
    }

    case "task:resume": {
      const taskId = asString(args.id);
      const payload = asRecord(args.payload);
      const task = ctx.findTask(taskId);
      if (task.status !== "waiting_input") {
        throw new Error("任务当前不在等待人工输入状态");
      }
      ctx.updateTask(taskId, {
        status: "running",
      });
      void ctx.executeTask(taskId, payload);
      return ctx.findTask(taskId);
    }

    case "task:remove": {
      const taskId = asString(args.id);
      const existing = ctx.tryFindTask(taskId);
      if (!existing) {
        return {
          id: taskId,
          removed: false,
        };
      }
      ctx.removedTaskIds.add(taskId);
      ctx.removeTaskFromStore(taskId);
      await ctx.waitTaskLogQueue(taskId);
      ctx.taskLogQueues.delete(taskId);
      await ctx.deleteTaskRuntime(taskId);
      return {
        id: taskId,
        removed: true,
      };
    }

    case "task:clear-completed": {
      const tasks = ctx.getTasksFromStore();
      const completedIds = tasks.filter((item) => item.status === "completed").map((item) => item.id);
      if (completedIds.length === 0) {
        return { count: 0, ids: [] as string[] };
      }

      ctx.setTasksToStore(tasks.filter((item) => item.status !== "completed"));

      for (const taskId of completedIds) {
        ctx.removedTaskIds.add(taskId);
        await ctx.waitTaskLogQueue(taskId);
        ctx.taskLogQueues.delete(taskId);
        await ctx.deleteTaskRuntime(taskId);
        ctx.emitTaskBroadcast("task:removed", { taskId });
      }

      return {
        count: completedIds.length,
        ids: completedIds,
      };
    }

    default:
      throw new Error(`未知命令: ${command}`);
  }
}
