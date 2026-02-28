import { computed, type Ref } from "vue";
import type { WorkflowGraph } from "src/components/workflow/types";
import { WORKFLOW_NODE_MACRO_MAP } from "src/shared/workflow-node-macros";
import {
  type BoardCard,
  type BoardFieldSchema,
  getNodeBoardSchema,
} from "src/components/workflow/board/board-schema";

interface BoardFieldUpdatePayload {
  nodeId: string;
  key: string;
  value: unknown;
}

interface BoardSection {
  key: string;
  title: string;
  emptyText: string;
  cards: BoardCard[];
}

function boardCategoryPriority(category: BoardCard["category"]): number {
  if (category === "required") {
    return 0;
  }
  if (category === "optional") {
    return 1;
  }
  return 2;
}

function resolveBoardCategory(fields: BoardFieldSchema[]): BoardCard["category"] {
  if (fields.length === 0) {
    return "default";
  }
  if (fields.some((field) => field.required)) {
    return "required";
  }
  if (fields.some((field) => field.defaultValue === undefined)) {
    return "optional";
  }
  return "default";
}

export function useWorkflowBoard(graphModel: Ref<WorkflowGraph>, isReadonly: Ref<boolean>) {
  const readNodeConfig = (nodeId: string): Record<string, unknown> => {
    const node = graphModel.value.nodes.find((item) => item.id === nodeId);
    const config = node?.config;
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      return {};
    }
    return config as Record<string, unknown>;
  };

  const boardCards = computed<BoardCard[]>(() => {
    const cards = graphModel.value.nodes.map((node, idx) => {
      const config = readNodeConfig(node.id);
      const sourceFields = getNodeBoardSchema(node.type);
      const fields = sourceFields.filter((field) => {
        return field.showWhen ? field.showWhen(config) : true;
      });
      const category = resolveBoardCategory(fields);
      const x = Number.isFinite(node.position?.x) ? Number(node.position?.x) : idx * 100;
      const y = Number.isFinite(node.position?.y) ? Number(node.position?.y) : 0;
      return {
        nodeId: node.id,
        nodeLabel: WORKFLOW_NODE_MACRO_MAP[node.type]?.label || node.id,
        nodeType: node.type,
        nodeTypeLabel: WORKFLOW_NODE_MACRO_MAP[node.type]?.label || node.type,
        category,
        fields,
        orderKey: y * 10000 + x,
      };
    });

    cards.sort((a, b) => {
      const priorityA = boardCategoryPriority(a.category);
      const priorityB = boardCategoryPriority(b.category);
      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }
      return a.orderKey - b.orderKey;
    });

    return cards;
  });

  const boardSections = computed<BoardSection[]>(() => {
    return [
      {
        key: "required",
        title: "必填配置",
        emptyText: "没有必填配置节点",
        cards: boardCards.value.filter((card) => card.category === "required"),
      },
      {
        key: "optional",
        title: "可选配置",
        emptyText: "没有可选配置节点",
        cards: boardCards.value.filter((card) => card.category === "optional"),
      },
      {
        key: "default",
        title: "默认配置（可直接运行）",
        emptyText: "没有默认配置节点",
        cards: boardCards.value.filter((card) => card.category === "default"),
      },
    ];
  });

  const patchNodeConfig = (nodeId: string, key: string, value: unknown): void => {
    if (isReadonly.value) {
      return;
    }
    graphModel.value = {
      ...graphModel.value,
      nodes: graphModel.value.nodes.map((node) => {
        if (node.id !== nodeId) {
          return node;
        }
        const currentConfig = node.config && typeof node.config === "object" && !Array.isArray(node.config)
          ? (node.config as Record<string, unknown>)
          : {};
        const nextConfig: Record<string, unknown> = {
          ...currentConfig,
        };
        const shouldDelete =
          value === undefined ||
          value === null ||
          (typeof value === "string" && value.trim().length === 0) ||
          (typeof value === "number" && !Number.isFinite(value));
        if (shouldDelete) {
          delete nextConfig[key];
        } else {
          nextConfig[key] = value;
        }
        return {
          ...node,
          config: nextConfig,
        };
      }),
    };
  };

  const handleBoardFieldUpdate = (payload: BoardFieldUpdatePayload): void => {
    patchNodeConfig(payload.nodeId, payload.key, payload.value);
  };

  return {
    boardSections,
    readNodeConfig,
    patchNodeConfig,
    handleBoardFieldUpdate,
  };
}
