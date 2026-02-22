import type { WebContents } from "electron";
import path from "node:path";
import type { WorkflowGraphNode, WorkflowTaskRecord } from "../../../shared/types";
import { asBoolean, asNumber, asRecord, asString, normalizeNodeOutput } from "../node-execution-helpers";
import type { NodeExecutionDeps, NodeExecutionResult } from "../node-execution";

function asPathList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function pickSinglePath(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (Array.isArray(value)) {
      const first = value.find((item) => typeof item === "string" && item.trim()) as string | undefined;
      if (first) {
        return first.trim();
      }
    }
  }
  return "";
}

function readSplitConfig(...values: unknown[]): Record<string, unknown> {
  for (const value of values) {
    if (!value) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const obj = asRecord(item);
        if (Object.keys(obj).length > 0) {
          return obj;
        }
      }
      continue;
    }
    const obj = asRecord(value);
    if (Object.keys(obj).length > 0) {
      return obj;
    }
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value) as unknown;
        const parsedObj = asRecord(parsed);
        if (Object.keys(parsedObj).length > 0) {
          return parsedObj;
        }
      } catch {
        // ignore invalid json and continue fallback chain
      }
    }
  }
  return {};
}

export async function executeMediaNode(
  task: WorkflowTaskRecord,
  sender: WebContents,
  node: WorkflowGraphNode,
  payload: Record<string, unknown>,
  config: Record<string, unknown>,
  deps: NodeExecutionDeps,
  defaultOutputKey: string,
): Promise<NodeExecutionResult> {
  if (node.type === "select_video") {
    const rawVideoPath = pickSinglePath(payload.videoPath, config.videoPath, task.runtimeInput.videoPath);
    const required = config.required === undefined ? false : asBoolean(config.required);
    if (!rawVideoPath && required) {
      throw new Error(`节点 ${node.label} 缺少视频路径(videoPath)`);
    }
    const videoPath = rawVideoPath ? path.resolve(rawVideoPath) : "";
    return {
      kind: "output",
      output: {
        videoPath,
        path: videoPath,
        [defaultOutputKey]: videoPath,
        result: videoPath,
      },
    };
  }

  if (node.type === "random_concat") {
    const files = Array.from(
      new Set([
        ...asPathList(payload.files),
        ...asPathList(payload.result),
        ...asPathList(config.files),
        ...asPathList(task.runtimeInput.files),
      ]),
    );
    if (files.length === 0) {
      throw new Error(`节点 ${node.label} 缺少候选视频输入(files)`);
    }

    const outputDir = path.resolve(asString(payload.outputDir || config.outputDir || task.runtimeInput.outputDir || task.runDir));
    await deps.ensureDir(outputDir);

    const startVideoRaw = pickSinglePath(
      payload.startVideo,
      payload.startingVideo,
      config.startVideo,
      config.startingVideo,
      task.runtimeInput.startVideo,
      task.runtimeInput.startingVideo,
    );
    const endVideoRaw = pickSinglePath(
      payload.endVideo,
      payload.endingVideo,
      config.endVideo,
      config.endingVideo,
      task.runtimeInput.endVideo,
      task.runtimeInput.endingVideo,
    );

    const concatResult = await deps.concatVideosInternal(sender, {
      inputDir: "",
      files,
      startingVideo: startVideoRaw ? path.resolve(startVideoRaw) : null,
      endingVideo: endVideoRaw ? path.resolve(endVideoRaw) : null,
      randomCountMin: Math.max(1, Math.round(asNumber(payload.randomCountMin || config.randomCountMin || task.runtimeInput.randomCountMin || 2))),
      randomCountMax: Math.max(1, Math.round(asNumber(payload.randomCountMax || config.randomCountMax || task.runtimeInput.randomCountMax || 4))),
      maxDepth: Math.max(0, Math.round(asNumber(payload.maxDepth || config.maxDepth || task.runtimeInput.maxDepth || 2))),
      runTimes: Math.max(1, Math.round(asNumber(payload.runTimes || config.runTimes || task.runtimeInput.runTimes || 1))),
      outputDir,
    });

    return {
      kind: "output",
      output: {
        files: concatResult.outputPaths,
        count: concatResult.outputPaths.length,
        message: concatResult.message,
        [defaultOutputKey]: concatResult.outputPaths,
        result: concatResult.message,
      },
    };
  }

  if (node.type === "remove_ending") {
    const outputDir = path.resolve(asString(payload.outputDir || config.outputDir || task.runtimeInput.outputDir || task.runDir));
    await deps.ensureDir(outputDir);

    const videoPaths = Array.from(
      new Set([
        ...asPathList(payload.files),
        ...asPathList(payload.result),
        ...asPathList(task.runtimeInput.files),
      ]),
    );
    if (videoPaths.length === 0) {
      throw new Error(`节点 ${node.label} 缺少待处理视频输入(files)`);
    }

    const splitConfig = readSplitConfig(payload.splitConfig, config.splitConfig, task.runtimeInput.splitConfig);
    if (Object.keys(splitConfig).length === 0) {
      throw new Error(`节点 ${node.label} 缺少拆解参数输入(splitConfig)`);
    }

    const algorithm = asString(splitConfig.algorithm || config.algorithm || task.runtimeInput.algorithm || "ssim");
    const threshold = asNumber(splitConfig.threshold || config.threshold || task.runtimeInput.threshold || 0.7);
    const minDuration = asNumber(splitConfig.minDuration || config.minDuration || task.runtimeInput.minDuration || 2);
    const newEndingVideoRaw = pickSinglePath(
      payload.newEndingVideo,
      config.newEndingVideo,
      task.runtimeInput.newEndingVideo,
    );
    const resolvedShuffleValue =
      splitConfig.shuffleSegments !== undefined
        ? splitConfig.shuffleSegments
        : payload.shuffleSegments !== undefined
          ? payload.shuffleSegments
          : config.shuffleSegments !== undefined
            ? config.shuffleSegments
            : task.runtimeInput.shuffleSegments;
    const shuffleSegments = asBoolean(resolvedShuffleValue);

    const outputFiles: string[] = [];
    for (const rawPath of videoPaths) {
      const videoPath = path.resolve(rawPath);
      await deps.removeEndingAndConcatInternal(sender, {
        videoPath,
        outputDir,
        algorithm,
        threshold,
        minDuration,
        newEndingVideo: newEndingVideoRaw ? path.resolve(newEndingVideoRaw) : null,
        shuffleSegments,
      });
      outputFiles.push(path.join(outputDir, `${path.parse(videoPath).name}_processed.mp4`));
    }

    const summary = `去结尾处理完成，共 ${String(outputFiles.length)} 个视频`;
    return {
      kind: "output",
      output: {
        files: outputFiles,
        count: outputFiles.length,
        message: summary,
        [defaultOutputKey]: outputFiles,
        result: summary,
      },
    };
  }

  return { kind: "output", output: normalizeNodeOutput(node, payload) };
}
