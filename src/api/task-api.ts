import { invoke } from "src/tauri-compat/core";
import type { TaskDetail, WorkflowTaskRecord } from "src/components/workflow/types";

export async function subscribeTasks(): Promise<void> {
  await invoke("task:subscribe");
}

export async function listTasks(): Promise<WorkflowTaskRecord[]> {
  return invoke<WorkflowTaskRecord[]>("task:list");
}

export async function getTask(id: string): Promise<TaskDetail> {
  return invoke<TaskDetail>("task:get", { id });
}

export async function resumeTask(id: string, payload: Record<string, unknown>): Promise<void> {
  await invoke("task:resume", { id, payload });
}

export async function cancelTask(id: string): Promise<void> {
  await invoke("task:cancel", { id });
}

export async function removeTask(id: string): Promise<{ id: string; removed: boolean }> {
  return invoke<{ id: string; removed: boolean }>("task:remove", { id });
}

export async function clearCompletedTasks(): Promise<{ count: number; ids: string[] }> {
  return invoke<{ count: number; ids: string[] }>("task:clear-completed");
}
