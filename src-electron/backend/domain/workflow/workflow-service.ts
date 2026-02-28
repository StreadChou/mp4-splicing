import type { WorkflowDefinition, WorkflowGraph, WorkflowGraphEdge, WorkflowGraphNode, WorkflowMeta } from "../../shared/types";

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
  function normalizeRemark(value: unknown): string {
    if (typeof value === "string") {
      return value.trim();
    }
    return "";
  }

  function toNodeMap(nodes: WorkflowGraphNode[]): Map<string, WorkflowGraphNode> {
    return new Map(nodes.map((node) => [node.id, node] as const));
  }

  function toEdgeSignatures(edges: WorkflowGraphEdge[]): string[] {
    return edges
      .map((edge) => [edge.source, edge.target, edge.sourceHandle || "", edge.targetHandle || ""].join("::"))
      .sort();
  }

  function isSystemGraphStructureMatched(current: WorkflowGraph, expected: WorkflowGraph): boolean {
    if (current.nodes.length !== expected.nodes.length || current.edges.length !== expected.edges.length) {
      return false;
    }

    const currentNodeMap = toNodeMap(current.nodes);
    for (const expectedNode of expected.nodes) {
      const currentNode = currentNodeMap.get(expectedNode.id);
      if (!currentNode) {
        return false;
      }
      if (currentNode.type !== expectedNode.type) {
        return false;
      }
      if (normalizeRemark(currentNode.remark) !== normalizeRemark(expectedNode.remark)) {
        return false;
      }
    }

    const currentEdgeSignatures = toEdgeSignatures(current.edges);
    const expectedEdgeSignatures = toEdgeSignatures(expected.edges);
    if (currentEdgeSignatures.length !== expectedEdgeSignatures.length) {
      return false;
    }
    for (let i = 0; i < currentEdgeSignatures.length; i += 1) {
      if (currentEdgeSignatures[i] !== expectedEdgeSignatures[i]) {
        return false;
      }
    }

    return true;
  }

  function mergeSystemGraphKeepUserNodeState(expected: WorkflowGraph, current: WorkflowGraph): WorkflowGraph {
    const currentNodeMap = toNodeMap(current.nodes);
    return {
      nodes: expected.nodes.map((expectedNode) => {
        const currentNode = currentNodeMap.get(expectedNode.id);
        if (
          !currentNode ||
          currentNode.type !== expectedNode.type ||
          normalizeRemark(currentNode.remark) !== normalizeRemark(expectedNode.remark)
        ) {
          return { ...expectedNode };
        }
        const mergedNode: WorkflowGraphNode = {
          ...expectedNode,
        };
        const nextConfig = currentNode.config ?? expectedNode.config;
        const nextPosition = currentNode.position ?? expectedNode.position;
        if (nextConfig) {
          mergedNode.config = nextConfig;
        }
        if (nextPosition) {
          mergedNode.position = nextPosition;
        }
        return mergedNode;
      }),
      edges: expected.edges.map((edge) => ({ ...edge })),
    };
  }

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

      const structureMatched = isSystemGraphStructureMatched(normalized.graph, systemWorkflow.graph);
      const metaChanged =
        normalized.name !== systemWorkflow.name ||
        normalized.description !== systemWorkflow.description ||
        normalized.source !== "system" ||
        normalized.readonly !== false ||
        normalized.schemaVersion !== deps.workflowSchemaVersion ||
        normalized.systemKind !== systemWorkflow.systemKind;
      if (!structureMatched || metaChanged) {
        const nextWorkflow: WorkflowDefinition = {
          ...normalized,
          name: systemWorkflow.name,
          description: systemWorkflow.description,
          source: "system",
          readonly: false,
          schemaVersion: deps.workflowSchemaVersion,
          systemKind: systemWorkflow.systemKind,
          graph: structureMatched ? normalized.graph : mergeSystemGraphKeepUserNodeState(systemWorkflow.graph, normalized.graph),
          updatedAt: systemWorkflow.updatedAt,
        };
        byId.set(systemWorkflow.id, nextWorkflow);
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
