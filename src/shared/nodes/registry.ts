import { NODE_DEFINITIONS } from "./defs";
import type { NodeDefinition } from "./types";
import type { NodeType } from "./enums";

const NODE_MAP = new Map<NodeType, NodeDefinition>(
  NODE_DEFINITIONS.map((definition) => [definition.type, definition]),
);

export function listNodeDefinitions(): NodeDefinition[] {
  return NODE_DEFINITIONS;
}

export function listPaletteNodeDefinitions(): NodeDefinition[] {
  return NODE_DEFINITIONS.filter((item) => item.palette);
}

export function getNodeDefinition(type: string): NodeDefinition | undefined {
  return NODE_MAP.get(type as NodeType);
}

export function requireNodeDefinition(type: string): NodeDefinition {
  const definition = getNodeDefinition(type);
  if (!definition) {
    throw new Error(`未知节点类型: ${type}`);
  }
  return definition;
}
