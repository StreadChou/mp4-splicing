import type { WebContents } from "electron";
import path from "node:path";
import type { WorkflowGraphNode, WorkflowTaskRecord } from "../../../shared/types";
import { asBoolean, asNumber, getGraphNodeLabel } from "../node-execution-helpers";
import type { NodeExecutionDeps, NodeExecutionResult } from "../node-execution";

function asPathList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item).trim()).filter(Boolean).map((item) => path.resolve(item));
}

function pickSinglePath(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return path.resolve(value.trim());
    }
    if (Array.isArray(value)) {
      const first = value.find((item) => typeof item === "string" && item.trim()) as string | undefined;
      if (first) {
        return path.resolve(first.trim());
      }
    }
  }
  return "";
}

function previewPath(value: string): string {
  const name = path.basename(value);
  return name || value;
}

function readLoopRunTimes(payload: Record<string, unknown>, task: WorkflowTaskRecord): number {
  const loopMeta =
    payload.__loop && typeof payload.__loop === "object" && !Array.isArray(payload.__loop)
      ? (payload.__loop as Record<string, unknown>)
      : {};
  const loopStrategy = String(loopMeta.strategy || "");
  if (loopStrategy === "repeat" && typeof payload.index === "number") {
    // 在图执行器已按 repeat 展开时，每次循环体只执行一次组合。
    return 1;
  }
  const raw = Math.round(asNumber(loopMeta.times ?? payload.runTimes ?? task.runtimeInput.runTimes ?? 1));
  return Math.max(1, raw || 1);
}

export async function executeSelectVideoNode(
  task: WorkflowTaskRecord,
  node: WorkflowGraphNode,
  payload: Record<string, unknown>,
  config: Record<string, unknown>,
): Promise<NodeExecutionResult> {
  const rawVideoPath = pickSinglePath(payload.videoPath, config.videoPath, task.runtimeInput.videoPath);
  return {
    kind: "output",
    output: {
      videoPath: rawVideoPath,
      path: rawVideoPath,
      result: rawVideoPath,
    },
  };
}

export async function executeComposeVideosNode(
  task: WorkflowTaskRecord,
  sender: WebContents,
  node: WorkflowGraphNode,
  payload: Record<string, unknown>,
  config: Record<string, unknown>,
  deps: NodeExecutionDeps,
): Promise<NodeExecutionResult> {
  const files = Array.from(
    new Set([
      ...asPathList(payload.files),
      ...asPathList(payload.result),
      ...asPathList(config.files),
      ...asPathList(task.runtimeInput.files),
    ]),
  );
  if (files.length === 0) {
    throw new Error(`节点 ${getGraphNodeLabel(node)} 缺少候选视频输入(files)`);
  }

  await deps.appendTaskLog(task.id, `候选视频总量: ${String(files.length)} 条`, "info", {
    nodeId: node.id,
    nodeLabel: getGraphNodeLabel(node),
  });
  for (let start = 0; start < files.length; start += 10) {
    const end = Math.min(start + 10, files.length);
    const summary = files.slice(start, end).map(previewPath).join(" | ");
    await deps.appendTaskLog(task.id, `${String(end)}/${String(files.length)} 即将组合: ${summary}`, "info", {
      nodeId: node.id,
      nodeLabel: getGraphNodeLabel(node),
    });
  }

  const outputDir = path.resolve(String(payload.outputDir || config.outputDir || task.runtimeInput.outputDir || task.runDir));
  await deps.ensureDir(outputDir);

  const runTimes = readLoopRunTimes(payload, task);
  const shuffle = asBoolean(payload.shuffle ?? config.shuffle ?? task.runtimeInput.shuffle ?? false);

  const startVideo = pickSinglePath(
    payload.startVideo,
    payload.startingVideo,
    config.startVideo,
    config.startingVideo,
    task.runtimeInput.startVideo,
    task.runtimeInput.startingVideo,
  );
  const endVideo = pickSinglePath(
    payload.endVideo,
    payload.endingVideo,
    config.endVideo,
    config.endingVideo,
    task.runtimeInput.endVideo,
    task.runtimeInput.endingVideo,
  );

  const result = await deps.concatVideosInternal(sender, {
    inputDir: "",
    files,
    startingVideo: startVideo || null,
    endingVideo: endVideo || null,
    randomCountMin: files.length,
    randomCountMax: files.length,
    maxDepth: 0,
    runTimes,
    outputDir,
    shuffle,
  });

  return {
    kind: "output",
    output: {
      file: result.outputPaths[0] || "",
      files: result.outputPaths,
      count: result.outputPaths.length,
      message: result.message,
      result: result.message,
    },
  };
}
