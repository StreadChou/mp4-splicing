import { NodeFieldType, listNodeDefinitions } from "src/shared/nodes";
import type { NodeFieldDefinition } from "src/shared/nodes";

export type BoardFieldKind = "text" | "textarea" | "number" | "boolean" | "select" | "directory" | "video" | "json";

export interface BoardFieldOption {
  label: string;
  value: string;
}

export interface BoardFieldSchema {
  key: string;
  label: string;
  kind: BoardFieldKind;
  required?: boolean;
  defaultValue?: unknown;
  placeholder?: string;
  helpText?: string;
  options?: BoardFieldOption[];
  min?: number;
  max?: number;
  step?: number;
  showWhen?: (config: Record<string, unknown>) => boolean;
}

export interface BoardCard {
  nodeId: string;
  nodeLabel: string;
  nodeType: string;
  nodeTypeLabel: string;
  category: "required" | "optional" | "default";
  fields: BoardFieldSchema[];
  orderKey: number;
}

const FIELD_KIND_MAP: Record<NodeFieldType, BoardFieldKind> = {
  [NodeFieldType.TEXT]: "text",
  [NodeFieldType.TEXTAREA]: "textarea",
  [NodeFieldType.NUMBER]: "number",
  [NodeFieldType.BOOLEAN]: "boolean",
  [NodeFieldType.SELECT]: "select",
  [NodeFieldType.DIRECTORY]: "directory",
  [NodeFieldType.VIDEO]: "video",
  [NodeFieldType.JSON]: "json",
};

function mapBoardField(field: NodeFieldDefinition): BoardFieldSchema {
  const mapped: BoardFieldSchema = {
    key: field.key,
    label: field.label,
    kind: FIELD_KIND_MAP[field.type],
    required: field.required,
  };

  if (field.defaultValue !== undefined) {
    mapped.defaultValue = field.defaultValue;
  }
  if (field.placeholder !== undefined) {
    mapped.placeholder = field.placeholder;
  }
  if (field.helpText !== undefined) {
    mapped.helpText = field.helpText;
  }
  if (field.options !== undefined) {
    mapped.options = field.options;
  }
  if (field.min !== undefined) {
    mapped.min = field.min;
  }
  if (field.max !== undefined) {
    mapped.max = field.max;
  }
  if (field.step !== undefined) {
    mapped.step = field.step;
  }
  if (field.showWhen !== undefined) {
    mapped.showWhen = field.showWhen;
  }

  return mapped;
}

const NODE_BOARD_SCHEMA_MAP: Record<string, BoardFieldSchema[]> = Object.fromEntries(
  listNodeDefinitions().map((definition) => [definition.type, definition.fields.map(mapBoardField)]),
);

export function getNodeBoardSchema(nodeType: string): BoardFieldSchema[] {
  return NODE_BOARD_SCHEMA_MAP[nodeType] || [];
}
