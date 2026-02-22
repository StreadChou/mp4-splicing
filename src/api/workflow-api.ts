import { invoke } from "src/tauri-compat/core";
import type { WorkflowDefinition, WorkflowGraph, WorkflowMeta } from "src/components/workflow/types";

export async function listWorkflows(): Promise<WorkflowMeta[]> {
  return invoke<WorkflowMeta[]>("workflow:list");
}

export async function getWorkflow(id: string): Promise<WorkflowDefinition> {
  return invoke<WorkflowDefinition>("workflow:get", { id });
}

export async function validateWorkflowGraph(graph: WorkflowGraph): Promise<{ valid: boolean; issues: string[] }> {
  return invoke<{ valid: boolean; issues: string[] }>("workflow:validate", { graph });
}

export async function createWorkflow(payload: {
  name: string;
  description: string;
  graph: WorkflowGraph;
}): Promise<WorkflowDefinition> {
  return invoke<WorkflowDefinition>("workflow:create", payload);
}

export async function updateWorkflow(payload: {
  id: string;
  name: string;
  description: string;
  graph: WorkflowGraph;
}): Promise<WorkflowDefinition> {
  return invoke<WorkflowDefinition>("workflow:update", payload);
}

export async function deleteWorkflow(id: string): Promise<void> {
  await invoke("workflow:delete", { id });
}

export async function duplicateWorkflow(id: string, newName?: string): Promise<WorkflowDefinition> {
  return invoke<WorkflowDefinition>("workflow:duplicate", { id, newName });
}

export async function restoreWorkflowDefault(id: string): Promise<WorkflowDefinition> {
  return invoke<WorkflowDefinition>("workflow:restore-default", { id });
}

export async function restoreAllWorkflowDefaults(): Promise<{ restoredIds: string[]; count: number }> {
  return invoke<{ restoredIds: string[]; count: number }>("workflow:restore-all-default");
}

export async function runWorkflow(payload: {
  id: string;
  runtimeInput?: Record<string, unknown>;
  graph?: WorkflowGraph;
}): Promise<{ id: string }> {
  return invoke<{ id: string }>("workflow:run", {
    runtimeInput: {},
    ...payload,
  });
}
