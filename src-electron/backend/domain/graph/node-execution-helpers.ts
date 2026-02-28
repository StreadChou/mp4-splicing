import { WORKFLOW_NODE_PORT_TEMPLATES } from "../../../../src/shared/workflow-node-macros";
import { getNodeDefinition } from "../../../../src/shared/nodes/registry";
import type { WorkflowGraphNode } from "../../shared/types";

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function asString(value: unknown): string {
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

export function asNumber(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

export function asBoolean(value: unknown): boolean {
  return Boolean(value);
}

export function normalizeNodeOutput(node: WorkflowGraphNode, rawValue: unknown): Record<string, unknown> {
  if (rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)) {
    return rawValue as Record<string, unknown>;
  }

  const firstOutput = (WORKFLOW_NODE_PORT_TEMPLATES[node.type]?.outputs || [])[0] || "result";
  return {
    [firstOutput]: rawValue,
    result: rawValue,
  };
}

export function getGraphNodeLabel(node: WorkflowGraphNode): string {
  const remark = asString(node.remark).trim();
  if (remark) {
    return remark;
  }
  return getNodeDefinition(node.type)?.name || node.id;
}
