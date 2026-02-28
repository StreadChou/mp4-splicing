import { PORT_VALUE_TYPES, WORKFLOW_NODE_MACRO_MAP, WORKFLOW_NODE_PORT_TEMPLATES } from "../../../../src/shared/workflow-node-macros";
import { PortDataType } from "../../../../src/shared/nodes/enums";
import { arePortSpecsCompatible, type PortTypeSpec } from "../../../../src/shared/nodes/port-compat";
import { getNodeDefinition } from "../../../../src/shared/nodes/registry";
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

function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }
  if (typeof value === "string") {
    return value.trim().length === 0;
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  if (typeof value === "number") {
    return !Number.isFinite(value);
  }
  return false;
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

function resolveNodePortTypeSpec(nodeType: string, direction: "input" | "output", portName: string): PortTypeSpec {
  const macro = WORKFLOW_NODE_MACRO_MAP[nodeType];
  if (!macro) {
    return {
      valueType: PORT_VALUE_TYPES.ANY_PAYLOAD as PortDataType,
      multiple: false,
    };
  }
  const ports = direction === "input" ? macro.inputs : macro.outputs;
  const found = ports.find((port) => port.name === portName);
  return {
    valueType: (found?.valueType ?? PORT_VALUE_TYPES.ANY_PAYLOAD) as PortDataType,
    multiple: found?.multiple === true,
  };
}

function resolveGraphNodeLabel(node: Pick<WorkflowGraphNode, "id" | "type" | "remark">): string {
  const remark = asString(node.remark).trim();
  if (remark) {
    return remark;
  }
  return getNodeDefinition(node.type)?.name || node.id;
}

export function normalizeWorkflowGraph(value: unknown): WorkflowGraph {
  const record = asRecord(value);
  const nodesInput = Array.isArray(record.nodes) ? record.nodes : [];
  const edgesInput = Array.isArray(record.edges) ? record.edges : [];

  const nodes: WorkflowGraphNode[] = nodesInput
    .map((item, idx) => {
      const node = asRecord(item);
      const type = asString(node.type).trim();
      if (!type) {
        return null;
      }
      const pos = asRecord(node.position);
      const posX = Number(pos.x);
      const posY = Number(pos.y);
      const remark = asString(node.remark).trim();

      const parsedNode: WorkflowGraphNode = {
        id: asString(node.id) || `node_${String(idx + 1)}`,
        type,
        config: asRecord(node.config),
      };

      if (remark) {
        parsedNode.remark = remark;
      }

      if (Number.isFinite(posX) && Number.isFinite(posY)) {
        parsedNode.position = {
          x: posX,
          y: posY,
        };
      }

      return parsedNode;
    })
    .filter((item): item is WorkflowGraphNode => item !== null);

  const nodeMap = new Map(nodes.map((node) => [node.id, node] as const));
  const edges: WorkflowGraphEdge[] = edgesInput
    .map((item, idx) => {
      const edge = asRecord(item);
      const source = asString(edge.source);
      const target = asString(edge.target);
      if (!source || !target) {
        return null;
      }

      const sourceNode = nodeMap.get(source);
      const targetNode = nodeMap.get(target);
      if (!sourceNode || !targetNode) {
        return null;
      }

      const sourcePorts = WORKFLOW_NODE_PORT_TEMPLATES[sourceNode.type]?.outputs || [];
      const targetPorts = WORKFLOW_NODE_PORT_TEMPLATES[targetNode.type]?.inputs || [];

      const sourceHandle = asString(edge.sourceHandle);
      const targetHandle = asString(edge.targetHandle);

      if (sourceHandle && !isCompatibleHandle(sourceHandle, sourcePorts, "out")) {
        return null;
      }
      if (targetHandle && !isCompatibleHandle(targetHandle, targetPorts, "in")) {
        return null;
      }

      const resolvedSourcePort = resolvePortName(sourceHandle || undefined, sourcePorts, "out", sourcePorts[0] || "result");
      const resolvedTargetPort = resolvePortName(
        targetHandle || undefined,
        targetPorts,
        "in",
        targetPorts[0] || resolvedSourcePort || "input",
      );

      const sourcePortSpec = resolveNodePortTypeSpec(sourceNode.type, "output", resolvedSourcePort);
      const targetPortSpec = resolveNodePortTypeSpec(targetNode.type, "input", resolvedTargetPort);
      if (!arePortSpecsCompatible(sourcePortSpec, targetPortSpec)) {
        return null;
      }

      const parsed: WorkflowGraphEdge = {
        id: asString(edge.id) || `edge_${String(idx + 1)}`,
        source,
        target,
      };
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

  for (const node of graph.nodes) {
    if (!getNodeDefinition(node.type)) {
      issues.push(`节点「${resolveGraphNodeLabel(node)}」类型不存在: ${node.type}`);
    }
  }

  return issues;
}

function hasRuntimeForInputPort(
  config: Record<string, unknown>,
  runtimeInput: Record<string, unknown>,
  portName: string,
): boolean {
  if (!isBlank(config[portName]) || !isBlank(runtimeInput[portName])) {
    return true;
  }
  if (portName === "dir") {
    return !isBlank(config.inputDir) || !isBlank(runtimeInput.inputDir);
  }
  if (portName === "outputDir") {
    return !isBlank(config.outputDir) || !isBlank(runtimeInput.outputDir);
  }
  if (portName === "text") {
    return !isBlank(config.text) || !isBlank(runtimeInput.text);
  }
  return false;
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

  const issues: string[] = [];

  for (const node of workflow.graph.nodes) {
    const definition = getNodeDefinition(node.type);
    if (!definition) {
      continue;
    }

    const config = asRecord(node.config);

    for (const field of definition.fields) {
      if (!field.required) {
        continue;
      }
      if (isBlank(config[field.key])) {
        issues.push(`节点「${resolveGraphNodeLabel(node)}」缺少必填配置(${field.key})`);
      }
    }

    const inputPorts = definition.ports.filter((port) => port.direction === "input" && port.required);
    for (const port of inputPorts) {
      const incoming = incomingByTarget.get(node.id) ?? [];
      const hasIncoming = incoming.some((edge) => {
        const sourceNode = nodeMap.get(edge.source);
        if (!sourceNode) {
          return false;
        }
        const sourcePorts = WORKFLOW_NODE_PORT_TEMPLATES[sourceNode.type]?.outputs || [];
        const targetPorts = WORKFLOW_NODE_PORT_TEMPLATES[node.type]?.inputs || [];
        const sourcePort = resolvePortName(edge.sourceHandle, sourcePorts, "out", sourcePorts[0] || "result");
        const targetPort = resolvePortName(edge.targetHandle, targetPorts, "in", sourcePort || targetPorts[0] || "input");
        return targetPort === port.name;
      });

      if (!hasIncoming && !hasRuntimeForInputPort(config, runtimeInput, port.name)) {
        issues.push(`节点「${resolveGraphNodeLabel(node)}」缺少必需输入端口(${port.name})`);
      }
    }
  }

  return issues;
}
