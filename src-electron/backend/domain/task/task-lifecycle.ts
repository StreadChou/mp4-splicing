import type { WebContents } from "electron";
import type { InteractionRequest, TaskRuntimeSnapshot, WorkflowTaskRecord } from "../../shared/types";

const TASK_LOG_LIMIT = 500;

interface CreateTaskLifecycleDeps {
  getTasksFromStore(): WorkflowTaskRecord[];
  setTasksToStore(tasks: WorkflowTaskRecord[]): void;
  readTaskRuntime(taskId: string): Promise<TaskRuntimeSnapshot>;
  writeTaskRuntime(taskId: string, runtime: TaskRuntimeSnapshot): Promise<void>;
  toIsoNow(): string;
}

export function createTaskLifecycle(deps: CreateTaskLifecycleDeps) {
  const taskSubscribers = new Set<WebContents>();
  const taskExecutionLocks = new Set<string>();
  const taskLogQueues = new Map<string, Promise<void>>();
  const removedTaskIds = new Set<string>();

  function registerTaskSubscriber(sender: WebContents): void {
    if (sender.isDestroyed()) {
      return;
    }
    taskSubscribers.add(sender);
  }

  function emitTaskBroadcast(event: string, payload: unknown): void {
    for (const sender of Array.from(taskSubscribers)) {
      if (sender.isDestroyed()) {
        taskSubscribers.delete(sender);
        continue;
      }
      sender.send("mp4handler:event", { event, payload });
    }
  }

  function tryFindTask(taskId: string): WorkflowTaskRecord | null {
    return deps.getTasksFromStore().find((item) => item.id === taskId) ?? null;
  }

  function isTaskRemoved(taskId: string): boolean {
    return removedTaskIds.has(taskId) || !tryFindTask(taskId);
  }

  function findTask(taskId: string): WorkflowTaskRecord {
    const task = tryFindTask(taskId);
    if (!task) {
      throw new Error("任务不存在");
    }
    return task;
  }

  function removeTaskFromStore(taskId: string): WorkflowTaskRecord | null {
    const tasks = deps.getTasksFromStore();
    const index = tasks.findIndex((item) => item.id === taskId);
    if (index < 0) {
      return null;
    }
    const removed = tasks[index] as WorkflowTaskRecord;
    tasks.splice(index, 1);
    deps.setTasksToStore(tasks);
    emitTaskBroadcast("task:removed", { taskId });
    return removed;
  }

  async function waitTaskLogQueue(taskId: string): Promise<void> {
    const pending = taskLogQueues.get(taskId);
    if (!pending) {
      return;
    }
    await pending.catch(() => undefined);
  }

  function updateTask(taskId: string, patch: Partial<WorkflowTaskRecord>): WorkflowTaskRecord {
    const tasks = deps.getTasksFromStore();
    const index = tasks.findIndex((item) => item.id === taskId);
    if (index < 0) {
      throw new Error("任务不存在");
    }
    const updated: WorkflowTaskRecord = {
      ...(tasks[index] as WorkflowTaskRecord),
      ...patch,
      updatedAt: deps.toIsoNow(),
    };
    tasks[index] = updated;
    deps.setTasksToStore(tasks);
    emitTaskBroadcast("task:update", updated);
    return updated;
  }

  async function appendTaskLog(
    taskId: string,
    message: string,
    level: "info" | "error" | "warn" = "info",
    meta?: { nodeId?: string; nodeLabel?: string },
  ): Promise<void> {
    if (isTaskRemoved(taskId)) {
      return;
    }

    const prev = taskLogQueues.get(taskId) ?? Promise.resolve();
    const next = prev
      .catch(() => undefined)
      .then(async () => {
        if (isTaskRemoved(taskId)) {
          return;
        }
        const runtime = await deps.readTaskRuntime(taskId);
        runtime.logs.push({
          timestamp: deps.toIsoNow(),
          level,
          message,
          ...(meta?.nodeId ? { nodeId: meta.nodeId } : {}),
          ...(meta?.nodeLabel ? { nodeLabel: meta.nodeLabel } : {}),
        });
        if (runtime.logs.length > TASK_LOG_LIMIT) {
          runtime.logs = runtime.logs.slice(runtime.logs.length - TASK_LOG_LIMIT);
        }
        await deps.writeTaskRuntime(taskId, runtime);
        if (!isTaskRemoved(taskId)) {
          emitTaskBroadcast("task:log", {
            taskId,
            entry: runtime.logs[runtime.logs.length - 1],
          });
        }
      });

    taskLogQueues.set(taskId, next);
    try {
      await next;
    } finally {
      if (taskLogQueues.get(taskId) === next) {
        taskLogQueues.delete(taskId);
      }
    }
  }

  function createTaskSender(taskId: string): WebContents {
    return {
      send: (_channel: string, message: unknown) => {
        const data = message as { event?: string; payload?: unknown } | undefined;
        if (!data?.event) {
          return;
        }
        emitTaskBroadcast("task:progress", {
          taskId,
          event: data.event,
          payload: data.payload,
        });
      },
    } as unknown as WebContents;
  }

  async function setWaitingInteraction(taskId: string, interaction: InteractionRequest): Promise<void> {
    if (isTaskRemoved(taskId)) {
      return;
    }
    const runtime = await deps.readTaskRuntime(taskId);
    runtime.interaction = interaction;
    await deps.writeTaskRuntime(taskId, runtime);
    if (isTaskRemoved(taskId)) {
      return;
    }
    updateTask(taskId, {
      status: "waiting_input",
      waitingInteraction: interaction,
      currentNodeId: interaction.nodeId,
    });
  }

  async function clearWaitingInteraction(taskId: string): Promise<void> {
    if (isTaskRemoved(taskId)) {
      return;
    }
    const runtime = await deps.readTaskRuntime(taskId);
    runtime.interaction = null;
    await deps.writeTaskRuntime(taskId, runtime);
    if (isTaskRemoved(taskId)) {
      return;
    }
    updateTask(taskId, {
      waitingInteraction: null,
    });
  }

  return {
    registerTaskSubscriber,
    emitTaskBroadcast,
    tryFindTask,
    isTaskRemoved,
    findTask,
    removeTaskFromStore,
    waitTaskLogQueue,
    updateTask,
    appendTaskLog,
    createTaskSender,
    setWaitingInteraction,
    clearWaitingInteraction,
    removedTaskIds,
    taskLogQueues,
    taskExecutionLocks,
  };
}
