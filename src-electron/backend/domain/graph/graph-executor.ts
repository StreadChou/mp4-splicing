import type { WebContents } from "electron";
import { WORKFLOW_NODE_PORT_TEMPLATES } from "../../../../src/shared/workflow-node-macros";
import { executeGraphNode, type NodeExecutionDeps } from "./node-execution";
import { getGraphNodeLabel } from "./node-execution-helpers";
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

interface IncomingEdgeBinding {
  sourceNode: WorkflowGraphNode | null;
  sourceResult: Record<string, unknown>;
  sourcePort: string;
  targetPort: string;
}

interface LoopExpandPlan {
  sourceNode: WorkflowGraphNode;
  sourceResult: Record<string, unknown>;
  count: number;
  concurrency: number;
}

export interface GraphExecutorDeps {
  readTaskRuntime(taskId: string): Promise<TaskRuntimeSnapshot>;
  writeTaskRuntime(taskId: string, runtime: TaskRuntimeSnapshot): Promise<void>;
  updateTask(taskId: string, patch: Partial<WorkflowTaskRecord>): WorkflowTaskRecord;
  appendTaskLog(
    taskId: string,
    message: string,
    level?: "info" | "error" | "warn",
    meta?: { nodeId?: string; nodeLabel?: string },
  ): Promise<void>;
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
  const firstOutput = (WORKFLOW_NODE_PORT_TEMPLATES[node.type]?.outputs || [])[0] || "result";
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

function appendLoopMeta(payload: Record<string, unknown>, sourceResult: Record<string, unknown>): void {
  const rawMeta = sourceResult.__loop;
  if (!rawMeta || typeof rawMeta !== "object" || Array.isArray(rawMeta)) {
    return;
  }
  const currentMeta = payload.__loop;
  if (!currentMeta || typeof currentMeta !== "object" || Array.isArray(currentMeta)) {
    payload.__loop = rawMeta;
    return;
  }
  payload.__loop = {
    ...(currentMeta as Record<string, unknown>),
    ...(rawMeta as Record<string, unknown>),
  };
}

function readSourceValue(sourceResult: Record<string, unknown>, sourcePort: string): unknown {
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
  return value;
}

function normalizePositiveInt(value: unknown, fallback: number): number {
  const num = Math.round(Number(value));
  if (!Number.isFinite(num) || num <= 0) {
    return fallback;
  }
  return num;
}

function resolveIncomingEdgeBindings(
  targetNode: WorkflowGraphNode,
  workflow: WorkflowDefinition,
  nodeOutputs: Record<string, Record<string, unknown>>,
): IncomingEdgeBinding[] {
  const nodeMap = new Map(workflow.graph.nodes.map((node) => [node.id, node] as const));
  const incomingEdges = workflow.graph.edges.filter((edge) => edge.target === targetNode.id);

  return incomingEdges.map((edge) => {
    const sourceNode = nodeMap.get(edge.source) || null;
    const sourceResult = nodeOutputs[edge.source] || {};
    const sourceOutputs = sourceNode ? WORKFLOW_NODE_PORT_TEMPLATES[sourceNode.type]?.outputs : undefined;
    const targetInputs = WORKFLOW_NODE_PORT_TEMPLATES[targetNode.type]?.inputs;
    const sourcePort = resolvePortName(edge.sourceHandle, sourceOutputs, "out", "result");
    const targetPort = resolvePortName(
      edge.targetHandle,
      targetInputs,
      "in",
      sourcePort || targetInputs?.[0] || "input",
    );
    return {
      sourceNode,
      sourceResult,
      sourcePort,
      targetPort,
    };
  });
}

function resolveLoopExpandPlan(bindings: IncomingEdgeBinding[]): LoopExpandPlan | null {
  const loopBindings = bindings.filter((binding) => {
    const nodeType = binding.sourceNode?.type;
    return nodeType === "iterate" || nodeType === "repeat";
  });
  if (loopBindings.length === 0) {
    return null;
  }

  const firstLoopSource = loopBindings[0]?.sourceNode;
  if (!firstLoopSource) {
    return null;
  }

  const sameLoopSource = loopBindings.every((binding) => binding.sourceNode?.id === firstLoopSource.id);
  if (!sameLoopSource) {
    throw new Error("当前不支持同时依赖多个循环源节点");
  }

  const hasDataPort = loopBindings.some((binding) => binding.sourcePort !== "done");
  if (!hasDataPort) {
    return null;
  }

  const loopResult = loopBindings[0]?.sourceResult || {};
  const loopMeta =
    loopResult.__loop && typeof loopResult.__loop === "object" && !Array.isArray(loopResult.__loop)
      ? (loopResult.__loop as Record<string, unknown>)
      : {};

  const count = normalizePositiveInt(loopMeta.count ?? loopMeta.times, 1);
  const concurrency = normalizePositiveInt(loopMeta.concurrency, 1);
  return {
    sourceNode: firstLoopSource,
    sourceResult: loopResult,
    count,
    concurrency,
  };
}

function resolveLoopBindingValue(
  plan: LoopExpandPlan,
  sourcePort: string,
  fallbackValue: unknown,
  index: number,
): unknown {
  const { sourceNode, sourceResult, count } = plan;
  if (sourceNode.type === "iterate") {
    if (sourcePort === "item") {
      return Array.isArray(sourceResult.item) ? sourceResult.item[index] : sourceResult.item;
    }
    if (sourcePort === "index") {
      return index;
    }
    if (sourcePort === "done") {
      return index === count - 1;
    }
    if (sourcePort === "raw") {
      return sourceResult.raw ?? sourceResult.result;
    }
  }

  if (sourceNode.type === "repeat") {
    if (sourcePort === "index") {
      return index;
    }
    if (sourcePort === "done") {
      return index === count - 1;
    }
    if (sourcePort === "raw") {
      return sourceResult.raw ?? sourceResult.result;
    }
  }

  if (Array.isArray(fallbackValue) && sourcePort !== "raw") {
    return fallbackValue[index];
  }
  return fallbackValue;
}

function buildNodeInputPayloadFromBindings(
  task: WorkflowTaskRecord,
  bindings: IncomingEdgeBinding[],
  expand?: { plan: LoopExpandPlan; index: number },
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  for (const binding of bindings) {
    const rawValue = readSourceValue(binding.sourceResult, binding.sourcePort);
    const value = expand && binding.sourceNode?.id === expand.plan.sourceNode.id
      ? resolveLoopBindingValue(expand.plan, binding.sourcePort, rawValue, expand.index)
      : rawValue;

    if (value !== undefined) {
      appendInputValue(payload, binding.targetPort, value);
    }
    if (binding.sourceNode && (binding.sourceNode.type === "iterate" || binding.sourceNode.type === "repeat")) {
      appendLoopMeta(payload, binding.sourceResult);
    }
  }

  for (const [key, value] of Object.entries(task.runtimeInput)) {
    if (!(key in payload)) {
      payload[key] = value;
    }
  }

  if (expand) {
    if (!("index" in payload)) {
      payload.index = expand.index;
    }
    if (!("done" in payload)) {
      payload.done = expand.index === expand.plan.count - 1;
    }
  }

  return payload;
}

function mergeIterationOutputs(iterationOutputs: Array<Record<string, unknown>>): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const output of iterationOutputs) {
    for (const [key, value] of Object.entries(output)) {
      if (!(key in merged)) {
        merged[key] = value;
        continue;
      }

      const existing = merged[key];
      if (Array.isArray(existing) && Array.isArray(value)) {
        merged[key] = [...existing, ...value];
      } else if (Array.isArray(existing)) {
        merged[key] = [...existing, value];
      } else if (Array.isArray(value)) {
        merged[key] = [existing, ...value];
      } else {
        merged[key] = [existing, value];
      }
    }
  }
  return merged;
}

function normalizeResumePayload(node: WorkflowGraphNode, resumePayload: Record<string, unknown>): Record<string, unknown> {
  if (resumePayload.payloadJson) {
    try {
      const parsed = JSON.parse(asString(resumePayload.payloadJson)) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const objectPayload = parsed as Record<string, unknown>;
        const firstOutput = (WORKFLOW_NODE_PORT_TEMPLATES[node.type]?.outputs || [])[0] || "result";
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
  const firstOutput = (WORKFLOW_NODE_PORT_TEMPLATES[node.type]?.outputs || [])[0] || "result";
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
    await deps.appendTaskLog(task.id, "已恢复人工输入，继续执行", "info", {
      nodeId: pendingNode.id,
      nodeLabel: getGraphNodeLabel(pendingNode),
    });
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
    const nodeLogMeta = {
      nodeId: readyNode.id,
      nodeLabel: getGraphNodeLabel(readyNode),
    };
    await deps.appendTaskLog(task.id, `节点开始执行: ${getGraphNodeLabel(readyNode)} (${readyNode.type})`, "info", nodeLogMeta);

    const incomingBindings = resolveIncomingEdgeBindings(readyNode, workflow, state.nodeOutputs);
    const loopExpandPlan = resolveLoopExpandPlan(incomingBindings);
    let result: Awaited<ReturnType<typeof executeGraphNode>>;
    try {
      if (!loopExpandPlan) {
        const payload = buildNodeInputPayloadFromBindings(task, incomingBindings);
        result = await executeGraphNode(task, sender, readyNode, payload, deps.nodeExecutionDeps);
      } else {
        const indexes = Array.from({ length: loopExpandPlan.count }, (_item, idx) => idx);
        const iterationOutputs: Array<Record<string, unknown>> = new Array(loopExpandPlan.count);
        await deps.appendTaskLog(
          task.id,
          `检测到循环源，节点将展开执行 ${String(loopExpandPlan.count)} 次（并发 ${String(loopExpandPlan.concurrency)}）`,
          "info",
          nodeLogMeta,
        );

        await deps.nodeExecutionDeps.runWithConcurrency(indexes, loopExpandPlan.concurrency, async (index) => {
          const payload = buildNodeInputPayloadFromBindings(task, incomingBindings, {
            plan: loopExpandPlan,
            index,
          });
          const iterationResult = await executeGraphNode(task, sender, readyNode, payload, deps.nodeExecutionDeps);
          if (iterationResult.kind === "wait") {
            throw new Error("循环展开节点不支持等待人工输入");
          }
          iterationOutputs[index] = iterationResult.output;
        });

        result = {
          kind: "output",
          output: mergeIterationOutputs(iterationOutputs.filter((item): item is Record<string, unknown> => !!item)),
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await deps.appendTaskLog(task.id, `节点执行失败: ${message}`, "error", nodeLogMeta);
      throw error;
    }

    if (result.kind === "wait") {
      state.pendingNodeId = readyNode.id;
      setGraphState(runtime, state);
      runtime.phase = "graph_waiting";
      runtime.interaction = result.interaction;
      await deps.writeTaskRuntime(task.id, runtime);
      await deps.setWaitingInteraction(task.id, result.interaction);
      await deps.appendTaskLog(task.id, "节点执行暂停，等待人工输入", "warn", nodeLogMeta);
      return;
    }

    state.nodeOutputs[readyNode.id] = result.output;
    executedSet.add(readyNode.id);
    state.executedNodeIds = Array.from(executedSet);
    setGraphState(runtime, state);
    runtime.phase = "graph_running";
    await deps.writeTaskRuntime(task.id, runtime);
    await deps.appendTaskLog(task.id, "节点执行完成", "info", nodeLogMeta);
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
