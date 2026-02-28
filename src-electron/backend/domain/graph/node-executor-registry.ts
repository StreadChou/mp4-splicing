import type { WebContents } from "electron";
import path from "node:path";
import { NodeType } from "../../../../src/shared/nodes/enums";
import type {
  InteractionField,
  InteractionFieldType,
  InteractionOption,
  InteractionRequest,
  WorkflowGraphNode,
  WorkflowTaskRecord,
} from "../../shared/types";
import { asBoolean, asNumber, asRecord, asString, getGraphNodeLabel, normalizeNodeOutput } from "./node-execution-helpers";
import type { NodeExecutionDeps, NodeExecutionResult, NodeExecutor } from "./node-execution";
import { executeComposeVideosNode, executeSelectVideoNode } from "./nodes/media.node";
import { executeCollectNode } from "./nodes/collect.node";
import { executeIterateNode, executeRepeatNode } from "./nodes/loop.node";
import { executeDownloadNode } from "./nodes/network.node";
import { executeSplitComposePerVideoNode } from "./nodes/split-compose-per-video.node";
import { executeAutoSplitNode, executeSplitAlgoNode } from "./nodes/video.node";

function parseInteractionFieldType(value: string): InteractionFieldType {
  if (
    value === "text" ||
    value === "textarea" ||
    value === "number" ||
    value === "boolean" ||
    value === "select" ||
    value === "json"
  ) {
    return value;
  }
  return "text";
}

function parseInteractionSchema(value: unknown): InteractionField[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item, idx) => {
      const raw = asRecord(item);
      const field: InteractionField = {
        id: asString(raw.id) || `field_${String(idx + 1)}`,
        label: asString(raw.label) || `字段 ${String(idx + 1)}`,
        type: parseInteractionFieldType(asString(raw.type) || "text"),
      };
      if (raw.required !== undefined) {
        field.required = asBoolean(raw.required);
      }
      if (raw.defaultValue !== undefined) {
        field.defaultValue = raw.defaultValue;
      }
      if (raw.placeholder !== undefined) {
        field.placeholder = asString(raw.placeholder);
      }
      if (raw.helpText !== undefined) {
        field.helpText = asString(raw.helpText);
      }
      if (Array.isArray(raw.options)) {
        field.options = raw.options
          .map((opt) => {
            const entry = asRecord(opt);
            const label = asString(entry.label);
            const val = asString(entry.value);
            if (!label || !val) {
              return null;
            }
            return { label, value: val } satisfies InteractionOption;
          })
          .filter((opt): opt is InteractionOption => opt !== null);
      }
      return field;
    })
    .filter(Boolean);
}

const executors: Record<string, NodeExecutor> = {
  [NodeType.INPUT_DIR]: async (task, _sender, node, payload, config) => {
    const inputDirRaw = asString(config.inputDir || payload.inputDir || payload.dir || task.runtimeInput.inputDir).trim();
    if (!inputDirRaw) {
      throw new Error(`节点 ${getGraphNodeLabel(node)} 缺少输入目录(inputDir)`);
    }
    const inputDir = path.resolve(inputDirRaw);
    return {
      kind: "output",
      output: {
        dir: inputDir,
        inputDir,
        path: inputDir,
        result: inputDir,
      },
    };
  },

  [NodeType.OUTPUT_DIR]: async (task, _sender, node, payload, config, deps) => {
    const outputDirRaw = asString(config.outputDir || payload.outputDir || payload.dir || task.runtimeInput.outputDir).trim();
    if (!outputDirRaw) {
      throw new Error(`节点 ${getGraphNodeLabel(node)} 缺少输出目录(outputDir)`);
    }
    const outputDir = path.resolve(outputDirRaw);
    await deps.ensureDir(outputDir);
    return {
      kind: "output",
      output: {
        outputDir,
        dir: outputDir,
        result: outputDir,
      },
    };
  },

  [NodeType.USER_INPUT]: async (task, _sender, node, payload, config) => {
    const text = asString(config.text || payload.text || payload.value || task.runtimeInput.text);
    if (!text.trim()) {
      throw new Error(`节点 ${getGraphNodeLabel(node)} 缺少文本输入`);
    }
    return {
      kind: "output",
      output: {
        text,
        value: text,
        result: text,
      },
    };
  },

  [NodeType.TEXT_SPLIT]: async (task, _sender, _node, payload, config) => {
    const mode = asString(config.mode) || "newline";
    const trimItem = config.trim === undefined ? true : asBoolean(config.trim);
    const removeEmpty = config.removeEmpty === undefined ? true : asBoolean(config.removeEmpty);
    const customSeparator = asString(config.customSeparator || config.separator);

    const rawInput = payload.text ?? payload.value ?? payload.result ?? config.text ?? task.runtimeInput.text;

    let items: string[] = [];
    const text = String(rawInput ?? "");
    const splitter =
      mode === "comma"
        ? ","
        : mode === "space"
          ? /\s+/g
          : mode === "custom"
            ? customSeparator || "\n"
            : /\r?\n/g;
    items = text.split(splitter as string | RegExp);

    if (trimItem) {
      items = items.map((item) => item.trim());
    }
    if (removeEmpty) {
      items = items.filter((item) => item.length > 0);
    }

    return {
      kind: "output",
      output: {
        items,
        count: items.length,
        result: items,
      },
    };
  },

  [NodeType.READ_MP4_FILES]: async (task, _sender, node, payload, config, deps) => {
    const dirPath = asString(payload.dir || payload.path || config.inputDir || task.runtimeInput.inputDir);
    if (!dirPath) {
      throw new Error(`节点 ${getGraphNodeLabel(node)} 缺少目录参数`);
    }
    const resolvedDir = path.resolve(dirPath);
    const recursive = config.recursive === undefined ? true : asBoolean(config.recursive);
    const maxDepth = recursive ? Math.max(0, Math.round(asNumber(config.maxDepth) || 2)) : 0;
    const files = recursive ? await deps.collectVideos(resolvedDir, maxDepth) : await deps.listMp4Files(resolvedDir);

    await deps.appendTaskLog(task.id, `扫描得到视频总量: ${String(files.length)} 条`, "info", {
      nodeId: node.id,
      nodeLabel: getGraphNodeLabel(node),
    });

    return {
      kind: "output",
      output: {
        files,
        count: files.length,
        result: files,
      },
    };
  },

  [NodeType.DOWNLOAD]: async (task, sender, node, payload, config, deps) => {
    return executeDownloadNode(task, sender, node, payload, config, deps);
  },

  [NodeType.ITERATE]: async (task, _sender, _node, payload, config) => {
    return executeIterateNode(task, payload, config);
  },

  [NodeType.REPEAT]: async (task, _sender, _node, payload, config) => {
    return executeRepeatNode(task, payload, config);
  },

  [NodeType.COLLECT]: async (_task, _sender, _node, payload) => {
    return executeCollectNode(payload);
  },

  [NodeType.BATCH_DOWNLOAD]: async (task, sender, node, payload, config, deps) => {
    return executeDownloadNode(task, sender, node, payload, config, deps);
  },

  [NodeType.SPLIT_ALGO_SSIM]: async (task, _sender, node, payload, config) => {
    return executeSplitAlgoNode(node.type, payload, config, task);
  },

  [NodeType.SPLIT_ALGO_HISTOGRAM]: async (task, _sender, node, payload, config) => {
    return executeSplitAlgoNode(node.type, payload, config, task);
  },

  [NodeType.SPLIT_ALGO_FRAME_DIFF]: async (task, _sender, node, payload, config) => {
    return executeSplitAlgoNode(node.type, payload, config, task);
  },

  [NodeType.SPLIT_COMPOSE_PER_VIDEO]: async (task, sender, node, payload, config, deps) => {
    return executeSplitComposePerVideoNode(task, sender, node, payload, config, deps);
  },

  [NodeType.AUTO_SPLIT]: async (task, sender, node, payload, config, deps) => {
    return executeAutoSplitNode(task, sender, node, payload, config, deps);
  },

  [NodeType.SELECT_VIDEO]: async (task, _sender, node, payload, config) => {
    return executeSelectVideoNode(task, node, payload, config);
  },

  [NodeType.COMPOSE_VIDEOS]: async (task, sender, node, payload, config, deps) => {
    return executeComposeVideosNode(task, sender, node, payload, config, deps);
  },

  [NodeType.HUMAN_INPUT]: async (task, _sender, node, payload, config) => {
    const schema = parseInteractionSchema(config.formSchema);
    const interaction: InteractionRequest = {
      taskId: task.id,
      nodeId: node.id,
      title: asString(config.title) || `${getGraphNodeLabel(node)} 需要人工处理`,
      description: asString(config.description) || "请填写该节点需要的参数后继续执行",
      formSchema:
        schema.length > 0
          ? schema
          : [
              {
                id: "payloadJson",
                label: "输入 JSON",
                type: "textarea",
                required: true,
                placeholder: "{\"result\": \"ok\"}",
              },
            ],
      context: payload,
    };
    return { kind: "wait", interaction };
  },

  [NodeType.IO_PASS]: async (task, _sender, node, payload, config) => {
    const key = asString(config.pickKey);
    if (key) {
      const value = payload[key] ?? task.runtimeInput[key];
      return { kind: "output", output: { out: value, result: value } };
    }
    return { kind: "output", output: normalizeNodeOutput(node, payload) };
  },

  [NodeType.CONTROL]: async (_task, _sender, node, payload, config) => {
    const action = asString(config.action) || "pass";
    if (action === "pick") {
      const key = asString(config.key);
      const value = payload[key];
      return { kind: "output", output: { out: value, result: value } };
    }
    return { kind: "output", output: normalizeNodeOutput(node, payload) };
  },
};

export function getNodeExecutor(nodeType: string): NodeExecutor | null {
  return executors[nodeType] || null;
}

export async function runNodeWithExecutor(
  executor: NodeExecutor,
  task: WorkflowTaskRecord,
  sender: WebContents,
  node: WorkflowGraphNode,
  payload: Record<string, unknown>,
  deps: NodeExecutionDeps,
): Promise<NodeExecutionResult> {
  const config = asRecord(node.config);
  return executor(task, sender, node, payload, config, deps);
}
