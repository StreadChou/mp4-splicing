import type { WorkflowDefinition, WorkflowMeta } from "../../shared/types";

interface CreateWorkflowServiceDeps {
  getWorkflowSchemaVersion(): number;
  setWorkflowSchemaVersion(version: number): void;
  resetWorkflowStore(): void;
  clearAllTaskRuntime(): Promise<void>;
  getWorkflowsFromStore(): WorkflowDefinition[];
  setWorkflowsToStore(workflows: WorkflowDefinition[]): void;
  createSystemWorkflowDefinitions(): WorkflowDefinition[];
  workflowSchemaVersion: number;
  removedTaskIds: Set<string>;
  taskLogQueues: Map<string, Promise<void>>;
  taskExecutionLocks: Set<string>;
}

export function createWorkflowService(deps: CreateWorkflowServiceDeps) {
  function normalizeWorkflowName(name: string): string {
    return name.trim().toLowerCase();
  }

  function workflowToMeta(workflow: WorkflowDefinition): WorkflowMeta {
    return {
      id: workflow.id,
      name: workflow.name,
      description: workflow.description,
      source: workflow.source,
      readonly: workflow.readonly,
      updatedAt: workflow.updatedAt,
      systemKind: workflow.systemKind,
    };
  }

  function findSystemWorkflowDefinition(workflowId: string): WorkflowDefinition | undefined {
    return deps.createSystemWorkflowDefinitions().find((item) => item.id === workflowId);
  }

  function ensureDefaultWorkflows(): void {
    if (deps.getWorkflowSchemaVersion() !== deps.workflowSchemaVersion) {
      deps.resetWorkflowStore();
      deps.setWorkflowSchemaVersion(deps.workflowSchemaVersion);
      void deps.clearAllTaskRuntime();
      deps.removedTaskIds.clear();
      deps.taskLogQueues.clear();
      deps.taskExecutionLocks.clear();
    }

    const systemDefinitions = deps.createSystemWorkflowDefinitions();
    const byId = new Map(deps.getWorkflowsFromStore().map((item) => [item.id, item] as const));
    let changed = false;
    const systemIdSet = new Set(systemDefinitions.map((item) => item.id));

    for (const systemWorkflow of systemDefinitions) {
      const existing = byId.get(systemWorkflow.id);
      if (!existing) {
        byId.set(systemWorkflow.id, systemWorkflow);
        changed = true;
        continue;
      }

      let normalized = existing;
      if (
        existing.source !== "system" ||
        existing.readonly !== false ||
        existing.schemaVersion !== deps.workflowSchemaVersion ||
        existing.systemKind !== systemWorkflow.systemKind
      ) {
        normalized = {
          ...existing,
          source: "system",
          readonly: false,
          schemaVersion: deps.workflowSchemaVersion,
          systemKind: systemWorkflow.systemKind,
        };
      }

      if (normalized !== existing) {
        byId.set(systemWorkflow.id, normalized);
        changed = true;
      }
    }

    for (const [workflowId, workflow] of Array.from(byId.entries())) {
      if (workflow.source === "system" && !systemIdSet.has(workflowId)) {
        byId.delete(workflowId);
        changed = true;
      }
    }

    if (changed) {
      deps.setWorkflowsToStore(Array.from(byId.values()));
    }
  }

  function assertWorkflowNameUnique(name: string, ignoreWorkflowId?: string): void {
    const normalized = normalizeWorkflowName(name);
    const duplicated = deps.getWorkflowsFromStore().find(
      (item) => normalizeWorkflowName(item.name) === normalized && item.id !== ignoreWorkflowId,
    );
    if (duplicated) {
      throw new Error("工作流名称重复，请使用其他名称");
    }
  }

  function getWorkflowById(workflowId: string): WorkflowDefinition {
    ensureDefaultWorkflows();
    const workflow = deps.getWorkflowsFromStore().find((item) => item.id === workflowId);
    if (!workflow) {
      throw new Error("工作流不存在");
    }
    return workflow;
  }

  return {
    normalizeWorkflowName,
    workflowToMeta,
    findSystemWorkflowDefinition,
    ensureDefaultWorkflows,
    assertWorkflowNameUnique,
    getWorkflowById,
  };
}
