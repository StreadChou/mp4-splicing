import type { WebContents } from "electron";
import path from "node:path";
import { executeMediaNode } from "./nodes/media.node";
import { executeNetworkNode } from "./nodes/network.node";
import { executeVideoNode } from "./nodes/video.node";
import { asBoolean, asNumber, asRecord, asString, normalizeNodeOutput } from "./node-execution-helpers";
import type {
  InteractionField,
  InteractionFieldType,
  InteractionOption,
  InteractionRequest,
  WorkflowGraphNode,
  WorkflowTaskRecord,
} from "../../shared/types";

type SegmentRange = {
  start_frame: number;
  end_frame: number;
};

export type NodeExecutionResult =
  | { kind: "output"; output: Record<string, unknown> }
  | { kind: "wait"; interaction: InteractionRequest };

export interface NodeExecutionDeps {
  ensureDir(dirPath: string): Promise<void>;
  collectVideos(dirPath: string, maxDepth: number): Promise<string[]>;
  listMp4Files(dirPath: string): Promise<string[]>;
  runWithConcurrency<T>(
    items: T[],
    limit: number,
    worker: (item: T) => Promise<void>,
  ): Promise<{ success: number; failed: number }>;
  downloadSingleFile(sender: WebContents, url: string, outputDir: string): Promise<string>;
  concatVideosInternal(
    sender: WebContents,
    params: {
      inputDir: string;
      files?: string[];
      startingVideo?: string | null;
      endingVideo: string | null;
      randomCountMin: number;
      randomCountMax: number;
      maxDepth: number;
      runTimes: number;
      outputDir: string;
    },
  ): Promise<{ message: string; outputPaths: string[] }>;
  autoSplitVideoInternal(
    sender: WebContents,
    params: {
      videoPath: string;
      outputDir: string;
      algorithm: string;
      threshold: number;
      minDuration: number;
      skipFirst: boolean;
      skipLast: boolean;
    },
  ): Promise<string>;
  removeEndingAndConcatInternal(
    sender: WebContents,
    params: {
      videoPath: string;
      outputDir: string;
      algorithm: string;
      threshold: number;
      minDuration: number;
      newEndingVideo: string | null;
      shuffleSegments: boolean;
    },
  ): Promise<string>;
  generateVideoSegmentsInternal(
    sender: WebContents,
    videoPath: string,
    segments: SegmentRange[],
    outputDir: string,
  ): Promise<string>;
  appendTaskLog(
    taskId: string,
    message: string,
    level?: "info" | "error" | "warn",
    meta?: { nodeId?: string; nodeLabel?: string },
  ): Promise<void>;
  parseSegmentsFromPayload(payload: Record<string, unknown>): SegmentRange[];
}

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
  return value.map((item, idx) => {
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
  });
}

function previewPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }
  return path.basename(trimmed) || trimmed;
}

export async function executeGraphNode(
  task: WorkflowTaskRecord,
  sender: WebContents,
  node: WorkflowGraphNode,
  payload: Record<string, unknown>,
  deps: NodeExecutionDeps,
): Promise<NodeExecutionResult> {
  const config = asRecord(node.config);
  const defaultOutputKey = node.outputs?.[0] || "result";

  if (node.type === "input_dir") {
    const inputDirRaw = asString(config.inputDir || payload.inputDir || payload.dir || task.runtimeInput.inputDir).trim();
    if (!inputDirRaw) {
      throw new Error(`节点 ${node.label} 缺少输入目录(inputDir)`);
    }
    const inputDir = path.resolve(inputDirRaw);
    return {
      kind: "output",
      output: {
        dir: inputDir,
        inputDir,
        path: inputDir,
        [defaultOutputKey]: inputDir,
        result: inputDir,
      },
    };
  }

  if (node.type === "output_dir") {
    const outputDirRaw = asString(config.outputDir || payload.outputDir || payload.dir || task.runtimeInput.outputDir).trim();
    if (!outputDirRaw) {
      throw new Error(`节点 ${node.label} 缺少输出目录(outputDir)`);
    }
    const outputDir = path.resolve(outputDirRaw);
    await deps.ensureDir(outputDir);
    return {
      kind: "output",
      output: {
        outputDir,
        dir: outputDir,
        [defaultOutputKey]: outputDir,
        result: outputDir,
      },
    };
  }

  if (node.type === "user_input") {
    const text = asString(config.text || config.value || payload.text || payload.value || task.runtimeInput.text || task.runtimeInput.urlsText);
    if (!text.trim()) {
      throw new Error(`节点 ${node.label} 缺少文本输入`);
    }
    return {
      kind: "output",
      output: {
        text,
        value: text,
        [defaultOutputKey]: text,
        result: text,
      },
    };
  }

  if (node.type === "text_split") {
    const mode = asString(config.mode) || "newline";
    const trimItem = config.trim === undefined ? true : asBoolean(config.trim);
    const removeEmpty = config.removeEmpty === undefined ? true : asBoolean(config.removeEmpty);
    const customSeparator = asString(config.customSeparator || config.separator);

    const rawInput = payload.text ?? payload.value ?? payload.items ?? payload.result ?? config.text ?? task.runtimeInput.text;

    let items: string[] = [];
    if (Array.isArray(rawInput)) {
      items = rawInput.map((item) => String(item));
    } else {
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
    }

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
        [defaultOutputKey]: items,
        result: items,
      },
    };
  }

  if (node.type === "human") {
    const schema = parseInteractionSchema(config.formSchema);
    const interaction: InteractionRequest = {
      taskId: task.id,
      nodeId: node.id,
      title: asString(config.title) || `${node.label} 需要人工处理`,
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
  }

  if (node.type === "io") {
    const action = asString(config.action) || "pass";
    if (action === "get_input") {
      const key = asString(config.key) || defaultOutputKey;
      let value = payload[key];
      if (value === undefined) {
        value = task.runtimeInput[key];
      }
      if (value === undefined && "defaultValue" in config) {
        value = config.defaultValue;
      }
      return { kind: "output", output: { [defaultOutputKey]: value, result: value } };
    }
    return { kind: "output", output: normalizeNodeOutput(node, payload) };
  }

  if (node.type === "control") {
    const action = asString(config.action) || "merge";
    if (action === "pick") {
      const key = asString(config.key);
      return { kind: "output", output: { [defaultOutputKey]: payload[key], result: payload[key] } };
    }
    if (action === "condition") {
      const key = asString(config.key) || "condition";
      const pass = asBoolean(payload[key]);
      return { kind: "output", output: { [defaultOutputKey]: payload, condition: pass, result: payload } };
    }
    return { kind: "output", output: normalizeNodeOutput(node, payload) };
  }

  if (node.type === "file") {
    const action = asString(config.action) || "read_mp4";
    if (action === "read_mp4") {
      const dirPath = asString(payload.dir || payload.path || config.inputDir || task.runtimeInput.inputDir);
      if (!dirPath) {
        throw new Error(`节点 ${node.label} 缺少目录参数`);
      }
      const resolvedDir = path.resolve(dirPath);
      const recursive = config.recursive === undefined ? true : asBoolean(config.recursive);
      const maxDepth = recursive ? Math.max(0, Math.round(asNumber(config.maxDepth) || 2)) : 0;
      const files = recursive ? await deps.collectVideos(resolvedDir, maxDepth) : await deps.listMp4Files(resolvedDir);
      await deps.appendTaskLog(task.id, `扫描得到视频总量: ${String(files.length)} 条`, "info", {
        nodeId: node.id,
        nodeLabel: node.label,
      });
      for (let start = 0; start < files.length; start += 10) {
        const end = Math.min(start + 10, files.length);
        const summary = files
          .slice(start, end)
          .map((item) => previewPath(item))
          .join(" | ");
        await deps.appendTaskLog(task.id, `${String(end)}/${String(files.length)} 即将输出: ${summary}`, "info", {
          nodeId: node.id,
          nodeLabel: node.label,
        });
      }
      return {
        kind: "output",
        output: {
          files,
          count: files.length,
          [defaultOutputKey]: files,
          result: files,
        },
      };
    }
    if (action === "ensure_dir") {
      const dirPath = asString(payload.dir || payload.outputDir || config.outputDir || task.runDir);
      await deps.ensureDir(dirPath);
      return { kind: "output", output: { dir: dirPath, result: dirPath, [defaultOutputKey]: dirPath } };
    }
    return { kind: "output", output: normalizeNodeOutput(node, payload) };
  }

  if (node.type === "network") {
    return executeNetworkNode(task, sender, node, payload, config, deps, defaultOutputKey);
  }

  if (node.type === "select_video" || node.type === "random_concat" || node.type === "remove_ending") {
    return executeMediaNode(task, sender, node, payload, config, deps, defaultOutputKey);
  }

  if (node.type === "video") {
    return executeVideoNode(task, sender, node, payload, config, deps, defaultOutputKey);
  }

  return { kind: "output", output: normalizeNodeOutput(node, payload) };
}
