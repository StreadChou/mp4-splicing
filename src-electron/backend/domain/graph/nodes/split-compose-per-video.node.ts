import type { WebContents } from "electron";
import fsp from "node:fs/promises";
import path from "node:path";
import type { WorkflowGraphNode, WorkflowTaskRecord } from "../../../shared/types";
import { asBoolean, asNumber, asString, getGraphNodeLabel } from "../node-execution-helpers";
import type { NodeExecutionDeps, NodeExecutionResult } from "../node-execution";

function asPathList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item).trim()).filter(Boolean).map((item) => path.resolve(item));
}

function asSinglePath(value: unknown): string[] {
  if (typeof value !== "string" || !value.trim()) {
    return [];
  }
  return [path.resolve(value.trim())];
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

function readLoopConcurrency(
  payload: Record<string, unknown>,
  config: Record<string, unknown>,
  runtimeInput: Record<string, unknown>,
): number {
  const loopMeta =
    payload.__loop && typeof payload.__loop === "object" && !Array.isArray(payload.__loop)
      ? (payload.__loop as Record<string, unknown>)
      : {};
  const parsed = Math.round(
    asNumber(loopMeta.concurrency ?? payload.loopConcurrency ?? config.loopConcurrency ?? runtimeInput.loopConcurrency ?? 1),
  );
  return Math.max(1, parsed || 1);
}

function readSplitAlgorithm(
  payload: Record<string, unknown>,
  config: Record<string, unknown>,
  runtimeInput: Record<string, unknown>,
): { algorithm: string; threshold: number; minDuration: number } {
  const fromPayload = payload.splitAlgorithm && typeof payload.splitAlgorithm === "object" && !Array.isArray(payload.splitAlgorithm)
    ? (payload.splitAlgorithm as Record<string, unknown>)
    : {};

  return {
    algorithm: asString(fromPayload.algorithm ?? payload.algorithm ?? config.algorithm ?? runtimeInput.algorithm).trim() || "ssim",
    threshold: asNumber(fromPayload.threshold ?? payload.threshold ?? config.threshold ?? runtimeInput.threshold ?? 0.7),
    minDuration: asNumber(fromPayload.minDuration ?? payload.minDuration ?? config.minDuration ?? runtimeInput.minDuration ?? 2),
  };
}

export async function executeSplitComposePerVideoNode(
  task: WorkflowTaskRecord,
  sender: WebContents,
  node: WorkflowGraphNode,
  payload: Record<string, unknown>,
  config: Record<string, unknown>,
  deps: NodeExecutionDeps,
): Promise<NodeExecutionResult> {
  const outputRoot = path.resolve(asString(payload.outputDir ?? config.outputDir ?? task.runtimeInput.outputDir ?? task.runDir));
  await deps.ensureDir(outputRoot);

  const filePaths = Array.from(
    new Set([
      ...asPathList(payload.file),
      ...asPathList(payload.files),
      ...asPathList(payload.result),
      ...asPathList(task.runtimeInput.file),
      ...asPathList(task.runtimeInput.files),
      ...asSinglePath(payload.file),
      ...asSinglePath(task.runtimeInput.file),
    ]),
  );
  if (filePaths.length === 0) {
    throw new Error(`节点 ${getGraphNodeLabel(node)} 缺少待处理视频(file)`);
  }

  const splitAlgorithm = readSplitAlgorithm(payload, config, task.runtimeInput);
  const dropHead = asBoolean(payload.dropHead ?? config.dropHead ?? task.runtimeInput.dropHead ?? false);
  const dropTail = asBoolean(payload.dropTail ?? config.dropTail ?? task.runtimeInput.dropTail ?? true);
  const shuffle = asBoolean(payload.shuffle ?? config.shuffle ?? task.runtimeInput.shuffle ?? true);
  const endVideo = pickSinglePath(payload.endVideo, config.endVideo, task.runtimeInput.endVideo) || null;
  const maxConcurrent = readLoopConcurrency(payload, config, task.runtimeInput);

  await deps.appendTaskLog(task.id, `单视频拆解并组合开始，输入 ${String(filePaths.length)} 条`, "info", {
    nodeId: node.id,
    nodeLabel: getGraphNodeLabel(node),
  });

  const outputFiles: string[] = [];
  const failedVideos: string[] = [];

  const { success, failed } = await deps.runWithConcurrency(filePaths, maxConcurrent, async (videoPath) => {
    const tempOutputRoot = path.join(
      task.runDir,
      ".tmp",
      "split_compose_per_video",
      `${node.id}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`,
    );
    try {
      await deps.ensureDir(tempOutputRoot);
      const videoName = path.parse(videoPath).name;
      const segmentOutputDir = path.join(tempOutputRoot, videoName);
      const existingBefore = await deps.listMp4Files(segmentOutputDir).catch(() => []);

      await deps.autoSplitVideoInternal(sender, {
        videoPath,
        outputDir: tempOutputRoot,
        algorithm: splitAlgorithm.algorithm,
        threshold: splitAlgorithm.threshold,
        minDuration: splitAlgorithm.minDuration,
        skipFirst: dropHead,
        skipLast: dropTail,
      });

      const existingAfter = await deps.listMp4Files(segmentOutputDir).catch(() => []);
      const beforeSet = new Set(existingBefore.map((item) => path.resolve(item)));
      const incremental = existingAfter.filter((item) => !beforeSet.has(path.resolve(item)));
      const segments = Array.from(new Set((incremental.length > 0 ? incremental : existingAfter).map((item) => path.resolve(item))));
      if (segments.length === 0) {
        throw new Error("拆解后未生成可组合片段");
      }

      const composeOutputDir = path.join(outputRoot, videoName);
      await deps.ensureDir(composeOutputDir);
      const composeResult = await deps.concatVideosInternal(sender, {
        inputDir: "",
        files: segments,
        startingVideo: null,
        endingVideo: endVideo,
        randomCountMin: segments.length,
        randomCountMax: segments.length,
        maxDepth: 0,
        runTimes: 1,
        outputDir: composeOutputDir,
        shuffle,
      });
      outputFiles.push(...composeResult.outputPaths.map((item) => path.resolve(item)));
    } catch {
      failedVideos.push(videoPath);
      throw new Error("single_video_process_failed");
    } finally {
      await fsp.rm(tempOutputRoot, { recursive: true, force: true }).catch(() => void 0);
    }
  });

  const uniqueOutputFiles = Array.from(new Set(outputFiles));
  const summary =
    failed > 0
      ? `单视频拆解并组合完成，成功 ${String(success)} 个，失败 ${String(failed)} 个，输出 ${String(uniqueOutputFiles.length)} 个文件`
      : `单视频拆解并组合完成，处理 ${String(success)} 个视频，输出 ${String(uniqueOutputFiles.length)} 个文件`;

  await deps.appendTaskLog(task.id, summary, failed > 0 ? "warn" : "info", {
    nodeId: node.id,
    nodeLabel: getGraphNodeLabel(node),
  });
  if (failedVideos.length > 0) {
    await deps.appendTaskLog(
      task.id,
      `失败视频: ${failedVideos.slice(0, 8).map((item) => path.basename(item)).join(" | ")}`,
      "warn",
      {
        nodeId: node.id,
        nodeLabel: getGraphNodeLabel(node),
      },
    );
  }

  return {
    kind: "output",
    output: {
      file: uniqueOutputFiles[0] || "",
      files: uniqueOutputFiles,
      failedVideos,
      result: summary,
    },
  };
}
