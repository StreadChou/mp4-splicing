import type { WebContents } from "electron";
import { executeGraphNode, type NodeExecutionDeps } from "./node-execution";
import type {
  InteractionRequest,
  TaskRuntimeSnapshot,
  WorkflowDefinition,
  WorkflowGraphNode,
  WorkflowTaskRecord,
} from "../../shared/types";

interface GraphExecutionState {
  executedNodeIds: string[];
  nodeOutputs: Record<string, Record<string, unknown>>;
  pendingNodeId: string;
}

export interface GraphExecutorDeps {
  readTaskRuntime(taskId: string): Promise<TaskRuntimeSnapshot>;
  writeTaskRuntime(taskId: string, runtime: TaskRuntimeSnapshot): Promise<void>;
  updateTask(taskId: string, patch: Partial<WorkflowTaskRecord>): WorkflowTaskRecord;
  appendTaskLog(taskId: string, message: string, level?: "info" | "error" | "warn"): Promise<void>;
  setWaitingInteraction(taskId: string, interaction: InteractionRequest): Promise<void>;
  clearWaitingInteraction(taskId: string): Promise<void>;
  createTaskSender(taskId: string): WebContents;
  nodeExecutionDeps: NodeExecutionDeps;
}

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

function resolvePortName(
  handleName: string | undefined,
  ports: string[] | undefined,
  prefix: "in" | "out",
  fallback: string,
): string {
  const effectivePorts = ports && ports.length > 0 ? ports : [fallback];
  if (!handleName) {
    return effectivePorts[0] as string;
  }

  const byName = effectivePorts.find((item) => item === handleName);
  if (byName) {
    return byName;
  }

  const match = handleName.match(new RegExp(`^${prefix}-(\\d+)$`));
  if (match) {
    const idx = Number(match[1]);
    if (Number.isFinite(idx) && idx >= 0 && idx < effectivePorts.length) {
      return effectivePorts[idx] as string;
    }
  }

  return effectivePorts[0] as string;
}

function normalizeNodeOutputForResume(node: WorkflowGraphNode, rawValue: unknown): Record<string, unknown> {
  if (rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)) {
    return rawValue as Record<string, unknown>;
  }
  const firstOutput = node.outputs?.[0] || "result";
  return {
    [firstOutput]: rawValue,
    result: rawValue,
  };
}

function getGraphState(runtime: TaskRuntimeSnapshot): GraphExecutionState {
  const graphState = asRecord(runtime.context.graphState);
  const executedNodeIds = asStringArray(graphState.executedNodeIds);
  const pendingNodeId = asString(graphState.pendingNodeId || runtime.context.pendingNodeId);
  const rawNodeOutputs = asRecord(graphState.nodeOutputs);
  const nodeOutputs: Record<string, Record<string, unknown>> = {};
  for (const [nodeId, outputs] of Object.entries(rawNodeOutputs)) {
    nodeOutputs[nodeId] = asRecord(outputs);
  }
  return { executedNodeIds, nodeOutputs, pendingNodeId };
}

function setGraphState(runtime: TaskRuntimeSnapshot, state: GraphExecutionState): void {
  runtime.context.graphState = {
    executedNodeIds: state.executedNodeIds,
    nodeOutputs: state.nodeOutputs,
    pendingNodeId: state.pendingNodeId,
  };
  runtime.context.pendingNodeId = state.pendingNodeId;
}

function appendInputValue(payload: Record<string, unknown>, key: string, value: unknown): void {
  if (!(key in payload)) {
    payload[key] = value;
    return;
  }
  const existing = payload[key];
  if (Array.isArray(existing)) {
    payload[key] = [...existing, value];
    return;
  }
  payload[key] = [existing, value];
}

function buildNodeInputPayload(
  task: WorkflowTaskRecord,
  targetNode: WorkflowGraphNode,
  workflow: WorkflowDefinition,
  nodeOutputs: Record<string, Record<string, unknown>>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  const nodeMap = new Map(workflow.graph.nodes.map((node) => [node.id, node] as const));

  const incomingEdges = workflow.graph.edges.filter((edge) => edge.target === targetNode.id);
  for (const edge of incomingEdges) {
    const sourceNode = nodeMap.get(edge.source);
    const sourceResult = nodeOutputs[edge.source] || {};
    const sourcePort = resolvePortName(edge.sourceHandle, sourceNode?.outputs, "out", "result");
    const targetPort = resolvePortName(
      edge.targetHandle,
      targetNode.inputs,
      "in",
      sourcePort || targetNode.inputs?.[0] || "input",
    );

    let value = sourceResult[sourcePort];
    if (value === undefined) {
      value = sourceResult.result;
    }
    if (value === undefined) {
      const values = Object.values(sourceResult);
      if (values.length > 0) {
        value = values[0];
      }
    }
    if (value !== undefined) {
      appendInputValue(payload, targetPort, value);
    }
  }

  for (const [key, value] of Object.entries(task.runtimeInput)) {
    if (!(key in payload)) {
      payload[key] = value;
    }
  }

  return payload;
}

function normalizeResumePayload(node: WorkflowGraphNode, resumePayload: Record<string, unknown>): Record<string, unknown> {
  if (resumePayload.payloadJson) {
    try {
      const parsed = JSON.parse(asString(resumePayload.payloadJson)) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const objectPayload = parsed as Record<string, unknown>;
        const firstOutput = node.outputs?.[0] || "result";
        const normalizedPayload: Record<string, unknown> = {
          ...objectPayload,
          result: objectPayload,
        };
        if (!(firstOutput in normalizedPayload)) {
          normalizedPayload[firstOutput] = objectPayload;
        }
        return normalizedPayload;
      }
      return normalizeNodeOutputForResume(node, parsed);
    } catch (error) {
      throw new Error(`人工输入 payloadJson 解析失败: ${String(error)}`);
    }
  }

  const objectPayload = asRecord(resumePayload);
  const firstOutput = node.outputs?.[0] || "result";
  const normalizedPayload: Record<string, unknown> = {
    ...objectPayload,
    result: objectPayload,
  };
  if (!(firstOutput in normalizedPayload)) {
    normalizedPayload[firstOutput] = objectPayload;
  }
  return normalizedPayload;
}

export async function executeWorkflowGraph(
  task: WorkflowTaskRecord,
  workflow: WorkflowDefinition,
  deps: GraphExecutorDeps,
  resumePayload?: Record<string, unknown>,
): Promise<void> {
  const runtime = await deps.readTaskRuntime(task.id);
  const sender = deps.createTaskSender(task.id);
  const graph = workflow.graph;

  if (graph.nodes.length === 0) {
    await deps.appendTaskLog(task.id, "工作流为空，任务直接完成");
    runtime.phase = "graph_done";
    await deps.writeTaskRuntime(task.id, runtime);
    return;
  }

  const nodeMap = new Map(graph.nodes.map((node) => [node.id, node] as const));
  const state = getGraphState(runtime);
  const executedSet = new Set(state.executedNodeIds);

  if (resumePayload) {
    const pendingNodeId = state.pendingNodeId;
    if (!pendingNodeId) {
      throw new Error("当前没有待恢复的人工节点");
    }
    const pendingNode = nodeMap.get(pendingNodeId);
    if (!pendingNode) {
      throw new Error("待恢复节点不存在");
    }

    const normalizedPayload = normalizeResumePayload(pendingNode, resumePayload);
    state.nodeOutputs[pendingNodeId] = normalizedPayload;
    executedSet.add(pendingNodeId);
    state.executedNodeIds = Array.from(executedSet);
    state.pendingNodeId = "";
    setGraphState(runtime, state);
    runtime.phase = "graph_running";
    runtime.interaction = null;
    await deps.writeTaskRuntime(task.id, runtime);
    await deps.clearWaitingInteraction(task.id);
    await deps.appendTaskLog(task.id, `已恢复人工节点: ${pendingNode.label}`);
  }

  while (executedSet.size < graph.nodes.length) {
    const readyNode = graph.nodes.find((node) => {
      if (executedSet.has(node.id)) {
        return false;
      }
      const predecessors = graph.edges.filter((edge) => edge.target === node.id).map((edge) => edge.source);
      return predecessors.every((pred) => executedSet.has(pred));
    });

    if (!readyNode) {
      throw new Error("无法找到可执行节点，可能存在循环依赖");
    }

    deps.updateTask(task.id, { currentNodeId: readyNode.id });
    await deps.appendTaskLog(task.id, `执行节点: ${readyNode.label} (${readyNode.type})`);

    const payload = buildNodeInputPayload(task, readyNode, workflow, state.nodeOutputs);
    const result = await executeGraphNode(task, sender, readyNode, payload, deps.nodeExecutionDeps);

    if (result.kind === "wait") {
      state.pendingNodeId = readyNode.id;
      setGraphState(runtime, state);
      runtime.phase = "graph_waiting";
      runtime.interaction = result.interaction;
      await deps.writeTaskRuntime(task.id, runtime);
      await deps.setWaitingInteraction(task.id, result.interaction);
      await deps.appendTaskLog(task.id, `节点 ${readyNode.label} 等待人工输入`, "warn");
      return;
    }

    state.nodeOutputs[readyNode.id] = result.output;
    executedSet.add(readyNode.id);
    state.executedNodeIds = Array.from(executedSet);
    setGraphState(runtime, state);
    runtime.phase = "graph_running";
    await deps.writeTaskRuntime(task.id, runtime);
  }

  runtime.phase = "graph_done";
  runtime.interaction = null;
  state.pendingNodeId = "";
  setGraphState(runtime, state);
  await deps.writeTaskRuntime(task.id, runtime);

  const lastNode = graph.nodes[graph.nodes.length - 1];
  const finalOutput = lastNode ? state.nodeOutputs[lastNode.id] : {};
  await deps.appendTaskLog(task.id, `图执行完成，最终输出: ${JSON.stringify(finalOutput || {})}`);
}
