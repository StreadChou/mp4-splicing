import { PORT_VALUE_TYPES, WORKFLOW_NODE_MACRO_MAP, WORKFLOW_NODE_PORT_TEMPLATES } from "../../../../src/shared/workflow-node-macros";
import type { WorkflowDefinition, WorkflowGraph, WorkflowGraphEdge, WorkflowGraphNode } from "../../shared/types";

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

function isCompatibleHandle(handleName: string, ports: string[], prefix: "in" | "out"): boolean {
  if (!handleName) {
    return true;
  }
  const effectivePorts = ports.length > 0 ? ports : [prefix === "out" ? "result" : "input"];
  if (effectivePorts.includes(handleName)) {
    return true;
  }
  const match = handleName.match(new RegExp(`^${prefix}-(\\d+)$`));
  if (!match) {
    return false;
  }
  const idx = Number(match[1]);
  return Number.isFinite(idx) && idx >= 0 && idx < effectivePorts.length;
}

function resolveNodePortValueType(nodeType: string, direction: "input" | "output", portName: string): string {
  const macro = WORKFLOW_NODE_MACRO_MAP[nodeType];
  if (!macro) {
    return PORT_VALUE_TYPES.ANY_PAYLOAD;
  }
  const ports = direction === "input" ? macro.inputs : macro.outputs;
  return ports.find((port) => port.name === portName)?.valueType ?? PORT_VALUE_TYPES.ANY_PAYLOAD;
}

function isPortValueTypeCompatible(sourceType: string, targetType: string): boolean {
  return (
    sourceType === targetType ||
    sourceType === PORT_VALUE_TYPES.ANY_PAYLOAD ||
    targetType === PORT_VALUE_TYPES.ANY_PAYLOAD
  );
}

function defaultActionForNodeType(nodeType: string): string {
  if (nodeType === "input_dir" || nodeType === "output_dir") {
    return "pick_dir";
  }
  if (nodeType === "user_input") {
    return "user_input";
  }
  if (nodeType === "text_split") {
    return "text_split";
  }
  if (nodeType === "file") {
    return "read_mp4";
  }
  if (nodeType === "select_video") {
    return "pick_video";
  }
  if (nodeType === "random_concat") {
    return "random_concat";
  }
  if (nodeType === "remove_ending") {
    return "remove_ending";
  }
  if (nodeType === "video") {
    return "auto_split";
  }
  if (nodeType === "network") {
    return "batch_download";
  }
  if (nodeType === "control") {
    return "merge";
  }
  if (nodeType === "io") {
    return "pass";
  }
  return "";
}

function normalizeLegacyEdgeHandles(
  sourceNode: WorkflowGraphNode,
  targetNode: WorkflowGraphNode,
  sourceHandle: string,
  targetHandle: string,
): { sourceHandle: string; targetHandle: string } {
  const sourcePorts = sourceNode.outputs ?? [];
  const targetPorts = targetNode.inputs ?? [];
  const resolvedSourcePort = resolvePortName(sourceHandle || undefined, sourcePorts, "out", sourcePorts[0] || "result");
  const resolvedTargetPort = resolvePortName(
    targetHandle || undefined,
    targetPorts,
    "in",
    targetPorts[0] || resolvedSourcePort || "input",
  );

  const sourceValueType = resolveNodePortValueType(sourceNode.type, "output", resolvedSourcePort);
  const targetValueType = resolveNodePortValueType(targetNode.type, "input", resolvedTargetPort);
  if (isPortValueTypeCompatible(sourceValueType, targetValueType)) {
    return { sourceHandle, targetHandle };
  }

  const sourceConfig = asRecord(sourceNode.config);
  const sourceAction = asString(sourceConfig.action).trim() || defaultActionForNodeType(sourceNode.type);

  // 兼容旧版工作流：video(auto_split) 过去用 result 连接 random_concat.files。
  if (
    sourceNode.type === "video" &&
    sourceAction === "auto_split" &&
    targetNode.type === "random_concat" &&
    resolvedTargetPort === "files" &&
    sourcePorts.includes("files")
  ) {
    return {
      sourceHandle: "files",
      targetHandle: targetHandle || "files",
    };
  }

  return { sourceHandle, targetHandle };
}

export function normalizeWorkflowGraph(value: unknown): WorkflowGraph {
  const record = asRecord(value);
  const nodesInput = Array.isArray(record.nodes) ? record.nodes : [];
  const edgesInput = Array.isArray(record.edges) ? record.edges : [];

  const nodes: WorkflowGraphNode[] = nodesInput.map((item, idx) => {
    const node = asRecord(item);
    const pos = asRecord(node.position);
    const posX = Number(pos.x);
    const posY = Number(pos.y);

    const baseNode: WorkflowGraphNode = {
      id: asString(node.id) || `node_${String(idx + 1)}`,
      type: asString(node.type) || "custom",
      label: asString(node.label) || `节点${String(idx + 1)}`,
      config: asRecord(node.config),
    };
    const inputs = Array.isArray(node.inputs) ? node.inputs.map((entry) => String(entry)).filter(Boolean) : [];
    const outputs = Array.isArray(node.outputs) ? node.outputs.map((entry) => String(entry)).filter(Boolean) : [];
    const canonicalPorts = WORKFLOW_NODE_PORT_TEMPLATES[baseNode.type];
    const finalInputs = canonicalPorts ? canonicalPorts.inputs : inputs;
    const finalOutputs = canonicalPorts ? canonicalPorts.outputs : outputs;
    if (finalInputs.length > 0) {
      baseNode.inputs = [...finalInputs];
    }
    if (finalOutputs.length > 0) {
      baseNode.outputs = [...finalOutputs];
    }
    if (Number.isFinite(posX) && Number.isFinite(posY)) {
      baseNode.position = {
        x: posX,
        y: posY,
      };
    }
    return baseNode;
  });

  const nodeMap = new Map(nodes.map((node) => [node.id, node] as const));
  const edges: WorkflowGraphEdge[] = edgesInput
    .map((item, idx) => {
      const edge = asRecord(item);
      const source = asString(edge.source);
      const target = asString(edge.target);
      if (!source || !target) {
        return null;
      }

      const parsed: WorkflowGraphEdge = {
        id: asString(edge.id) || `edge_${String(idx + 1)}`,
        source,
        target,
      };

      const sourceNode = nodeMap.get(source);
      const targetNode = nodeMap.get(target);
      if (!sourceNode || !targetNode) {
        return null;
      }

      let sourceHandle = asString(edge.sourceHandle);
      let targetHandle = asString(edge.targetHandle);
      const normalizedHandles = normalizeLegacyEdgeHandles(sourceNode, targetNode, sourceHandle, targetHandle);
      sourceHandle = normalizedHandles.sourceHandle;
      targetHandle = normalizedHandles.targetHandle;
      const sourcePorts = sourceNode.outputs ?? [];
      const targetPorts = targetNode.inputs ?? [];
      if (sourceHandle && !isCompatibleHandle(sourceHandle, sourcePorts, "out")) {
        return null;
      }
      if (targetHandle && !isCompatibleHandle(targetHandle, targetPorts, "in")) {
        return null;
      }

      const resolvedSourcePort = resolvePortName(sourceHandle, sourcePorts, "out", sourcePorts[0] || "result");
      const resolvedTargetPort = resolvePortName(
        targetHandle,
        targetPorts,
        "in",
        targetPorts[0] || resolvedSourcePort || "input",
      );
      const sourceValueType = resolveNodePortValueType(sourceNode.type, "output", resolvedSourcePort);
      const targetValueType = resolveNodePortValueType(targetNode.type, "input", resolvedTargetPort);
      if (!isPortValueTypeCompatible(sourceValueType, targetValueType)) {
        return null;
      }

      if (sourceHandle) {
        parsed.sourceHandle = sourceHandle;
      }
      if (targetHandle) {
        parsed.targetHandle = targetHandle;
      }
      return parsed;
    })
    .filter((item): item is WorkflowGraphEdge => item !== null);

  return { nodes, edges };
}

export function validateWorkflowGraphStructure(graph: WorkflowGraph): string[] {
  const issues: string[] = [];
  if (graph.nodes.length === 0) {
    issues.push("至少需要一个节点");
  }

  const nodeIdSet = new Set(graph.nodes.map((node) => node.id));
  for (const edge of graph.edges) {
    if (!nodeIdSet.has(edge.source) || !nodeIdSet.has(edge.target)) {
      issues.push(`连线 ${edge.id} 引用了不存在的节点`);
    }
  }

  return issues;
}

export function validateWorkflowRunConfig(workflow: WorkflowDefinition, runtimeInput: Record<string, unknown>): string[] {
  if (workflow.graph.nodes.length === 0) {
    return [];
  }

  const nodeMap = new Map(workflow.graph.nodes.map((node) => [node.id, node] as const));
  const incomingByTarget = new Map<string, WorkflowGraphEdge[]>();
  for (const edge of workflow.graph.edges) {
    const list = incomingByTarget.get(edge.target) ?? [];
    list.push(edge);
    incomingByTarget.set(edge.target, list);
  }

  const hasIncomingBy = (
    node: WorkflowGraphNode,
    matcher: (sourceNode: WorkflowGraphNode, sourcePort: string, targetPort: string) => boolean,
  ): boolean => {
    const incomingEdges = incomingByTarget.get(node.id) ?? [];
    return incomingEdges.some((edge) => {
      const sourceNode = nodeMap.get(edge.source);
      if (!sourceNode) {
        return false;
      }
      const sourcePort = resolvePortName(edge.sourceHandle, sourceNode.outputs, "out", "result");
      const targetPort = resolvePortName(edge.targetHandle, node.inputs, "in", sourcePort || "input");
      return matcher(sourceNode, sourcePort, targetPort);
    });
  };

  const hasIncomingInputDirProvider = (node: WorkflowGraphNode) =>
    hasIncomingBy(
      node,
      (sourceNode, sourcePort, targetPort) =>
        sourceNode.type === "input_dir" ||
        sourcePort === "dir" ||
        sourcePort === "inputDir" ||
        sourcePort === "path" ||
        targetPort === "dir" ||
        targetPort === "inputDir" ||
        targetPort === "path",
    );

  const hasIncomingOutputDirProvider = (node: WorkflowGraphNode) =>
    hasIncomingBy(
      node,
      (sourceNode, sourcePort, targetPort) =>
        sourceNode.type === "output_dir" || sourcePort === "outputDir" || targetPort === "outputDir",
    );

  const hasIncomingTextProvider = (node: WorkflowGraphNode) =>
    hasIncomingBy(
      node,
      (sourceNode, sourcePort, targetPort) =>
        sourceNode.type === "user_input" ||
        sourcePort === "text" ||
        sourcePort === "value" ||
        sourcePort === "result" ||
        targetPort === "text",
    );

  const hasIncomingUrlsProvider = (node: WorkflowGraphNode) =>
    hasIncomingBy(
      node,
      (sourceNode, sourcePort, targetPort) =>
        sourceNode.type === "text_split" ||
        sourcePort === "items" ||
        sourcePort === "urls" ||
        sourcePort === "files" ||
        targetPort === "urls" ||
        targetPort === "items",
    );

  const hasIncomingFilesProvider = (node: WorkflowGraphNode) =>
    hasIncomingBy(node, (_sourceNode, sourcePort, targetPort) => sourcePort === "files" || targetPort === "files");

  const hasIncomingSplitConfigProvider = (node: WorkflowGraphNode) =>
    hasIncomingBy(
      node,
      (_sourceNode, sourcePort, targetPort) => sourcePort === "splitConfig" || targetPort === "splitConfig",
    );

  const issues: string[] = [];
  for (const node of workflow.graph.nodes) {
    const config = asRecord(node.config);
    const action = asString(config.action).trim() || defaultActionForNodeType(node.type);
    const inputDir = asString(config.inputDir || runtimeInput.inputDir).trim();
    const outputDir = asString(config.outputDir || runtimeInput.outputDir).trim();
    const hasInputSource = hasIncomingInputDirProvider(node);
    const hasOutputSource = hasIncomingOutputDirProvider(node);
    const hasTextSource = hasIncomingTextProvider(node);
    const hasUrlsSource = hasIncomingUrlsProvider(node);
    const hasFilesSource = hasIncomingFilesProvider(node);
    const hasSplitConfigSource = hasIncomingSplitConfigProvider(node);

    if (node.type === "input_dir" && !inputDir) {
      issues.push(`节点「${node.label}」缺少输入目录(inputDir)`);
    }

    if (node.type === "output_dir" && !outputDir) {
      issues.push(`节点「${node.label}」缺少输出目录(outputDir)`);
    }

    if (node.type === "file" && action === "read_mp4" && !inputDir && !hasInputSource) {
      issues.push(`节点「${node.label}」缺少输入目录(inputDir)`);
    }

    if (node.type === "select_video") {
      const videoPath = asString(config.videoPath || runtimeInput.videoPath).trim();
      const required = config.required === undefined ? false : Boolean(config.required);
      if (required && !videoPath) {
        issues.push(`节点「${node.label}」缺少视频路径(videoPath)`);
      }
    }

    if (node.type === "user_input") {
      const text = asString(config.text || runtimeInput.text || runtimeInput.urlsText).trim();
      if (!text) {
        issues.push(`节点「${node.label}」缺少文本输入`);
      }
    }

    if (node.type === "text_split") {
      const text = asString(config.text || runtimeInput.text || runtimeInput.urlsText).trim();
      if (!hasTextSource && !text) {
        issues.push(`节点「${node.label}」缺少文本输入来源`);
      }
    }

    if (node.type === "network" && action === "batch_download") {
      const urlsText = asString(config.urlsText || runtimeInput.urlsText).trim();
      const urlArray = Array.isArray(config.urls) ? config.urls : Array.isArray(runtimeInput.urls) ? runtimeInput.urls : [];
      if (!hasUrlsSource && urlsText.length === 0 && urlArray.length === 0) {
        issues.push(`节点「${node.label}」缺少下载 URL 输入`);
      }
      if (!outputDir && !hasOutputSource) {
        issues.push(`节点「${node.label}」缺少输出目录(outputDir)`);
      }
    }

    if (node.type === "video" && action === "auto_split") {
      const runtimeFiles = Array.isArray(runtimeInput.files) ? runtimeInput.files.filter(Boolean) : [];
      const runtimeVideoPath = asString(runtimeInput.videoPath).trim();
      const configVideoPath = asString(config.videoPath).trim();
      if (!hasFilesSource && runtimeFiles.length === 0 && !runtimeVideoPath && !configVideoPath) {
        issues.push(`节点「${node.label}」缺少视频输入(files/videoPath)`);
      }
      if (!outputDir && !hasOutputSource) {
        issues.push(`节点「${node.label}」缺少输出目录(outputDir)`);
      }
    }

    if (node.type === "video" && action === "split_profile") {
      const algorithm = asString(config.algorithm || runtimeInput.algorithm).trim();
      if (!algorithm) {
        issues.push(`节点「${node.label}」缺少拆解算法(algorithm)`);
      }
    }

    if (node.type === "video" && (action === "concat" || action === "remove_ending")) {
      if (!hasFilesSource && !inputDir && !hasInputSource) {
        issues.push(`节点「${node.label}」缺少输入目录(inputDir)`);
      }
      if (!outputDir && !hasOutputSource) {
        issues.push(`节点「${node.label}」缺少输出目录(outputDir)`);
      }
    }

    if (node.type === "video" && action === "split_segments" && !outputDir && !hasOutputSource) {
      issues.push(`节点「${node.label}」缺少输出目录(outputDir)`);
    }

    if (node.type === "random_concat") {
      const runtimeFiles = Array.isArray(runtimeInput.files) ? runtimeInput.files.filter(Boolean) : [];
      if (!hasFilesSource && runtimeFiles.length === 0) {
        issues.push(`节点「${node.label}」缺少候选视频输入(files)`);
      }
      if (!outputDir && !hasOutputSource) {
        issues.push(`节点「${node.label}」缺少输出目录(outputDir)`);
      }
    }

    if (node.type === "remove_ending") {
      const runtimeFiles = Array.isArray(runtimeInput.files) ? runtimeInput.files.filter(Boolean) : [];
      if (!hasFilesSource && runtimeFiles.length === 0) {
        issues.push(`节点「${node.label}」缺少待处理视频输入(files)`);
      }
      if (!hasSplitConfigSource && !runtimeInput.splitConfig) {
        issues.push(`节点「${node.label}」缺少拆解参数输入(splitConfig)`);
      }
      if (!outputDir && !hasOutputSource) {
        issues.push(`节点「${node.label}」缺少输出目录(outputDir)`);
      }
    }
  }

  return issues;
}
