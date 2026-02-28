import type { WebContents } from "electron";
import path from "node:path";
import type { WorkflowGraphNode, WorkflowTaskRecord } from "../../../shared/types";
import { SplitAlgorithmKind } from "../../../../../src/shared/nodes/enums";
import { asBoolean, asNumber, asString, getGraphNodeLabel } from "../node-execution-helpers";
import type { NodeExecutionDeps, NodeExecutionResult } from "../node-execution";

interface SplitAlgorithmPayload {
  algorithm: string;
  threshold: number;
  minDuration: number;
}

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

function firstDefined(values: unknown[]): unknown {
  for (const value of values) {
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function readSplitAlgorithm(
  payload: Record<string, unknown>,
  config: Record<string, unknown>,
  runtimeInput: Record<string, unknown>,
): SplitAlgorithmPayload {
  const fromPayload = payload.splitAlgorithm && typeof payload.splitAlgorithm === "object"
    ? (payload.splitAlgorithm as Record<string, unknown>)
    : {};
  const algorithm = asString(firstDefined([
    fromPayload.algorithm,
    payload.algorithm,
    config.algorithm,
    runtimeInput.algorithm,
    SplitAlgorithmKind.SSIM,
  ]));
  const threshold = asNumber(firstDefined([fromPayload.threshold, payload.threshold, config.threshold, runtimeInput.threshold, 0.7]));
  const minDuration = asNumber(firstDefined([
    fromPayload.minDuration,
    payload.minDuration,
    config.minDuration,
    runtimeInput.minDuration,
    2,
  ]));

  return {
    algorithm,
    threshold,
    minDuration,
  };
}

function createSplitAlgorithmOutput(
  algorithm: string,
  threshold: number,
  minDuration: number,
): NodeExecutionResult {
  return {
    kind: "output",
    output: {
      splitAlgorithm: {
        algorithm,
        threshold,
        minDuration,
      },
      result: "已生成拆解算法配置",
    },
  };
}

export async function executeSplitAlgoNode(
  nodeType: string,
  payload: Record<string, unknown>,
  config: Record<string, unknown>,
  task: WorkflowTaskRecord,
): Promise<NodeExecutionResult> {
  const base = readSplitAlgorithm(payload, config, task.runtimeInput);
  const algorithm =
    nodeType === "split_algo_histogram"
      ? SplitAlgorithmKind.HISTOGRAM
      : nodeType === "split_algo_frame_diff"
        ? SplitAlgorithmKind.FRAME_DIFF
        : SplitAlgorithmKind.SSIM;

  return createSplitAlgorithmOutput(algorithm, base.threshold, base.minDuration);
}

export async function executeAutoSplitNode(
  task: WorkflowTaskRecord,
  sender: WebContents,
  node: WorkflowGraphNode,
  payload: Record<string, unknown>,
  config: Record<string, unknown>,
  deps: NodeExecutionDeps,
): Promise<NodeExecutionResult> {
  const outputDir = path.resolve(asString(payload.outputDir || config.outputDir || task.runtimeInput.outputDir || task.runDir));
  await deps.ensureDir(outputDir);

  const loopMeta =
    payload.__loop && typeof payload.__loop === "object" && !Array.isArray(payload.__loop)
      ? (payload.__loop as Record<string, unknown>)
      : {};
  const maxConcurrent = Math.max(
    1,
    Math.round(asNumber(loopMeta.concurrency ?? payload.loopConcurrency ?? config.loopConcurrency ?? task.runtimeInput.loopConcurrency ?? 1)),
  );

  const videoPaths = Array.from(
    new Set([
      ...asPathList(payload.file),
      ...asPathList(payload.files),
      ...asPathList(payload.result),
      ...asPathList(task.runtimeInput.files),
      ...asSinglePath(payload.file),
      ...(payload.videoPath ? [path.resolve(asString(payload.videoPath))] : []),
      ...asSinglePath(task.runtimeInput.file),
      ...(task.runtimeInput.videoPath ? [path.resolve(asString(task.runtimeInput.videoPath))] : []),
    ]),
  );

  if (videoPaths.length === 0) {
    throw new Error(`节点 ${getGraphNodeLabel(node)} 缺少可处理视频(file/videoPath)`);
  }

  const splitAlgorithm = readSplitAlgorithm(payload, config, task.runtimeInput);
  const dropHead = asBoolean(payload.dropHead ?? config.dropHead ?? task.runtimeInput.dropHead ?? false);
  const dropTail = asBoolean(payload.dropTail ?? config.dropTail ?? task.runtimeInput.dropTail ?? false);

  await deps.appendTaskLog(task.id, `待自动拆解视频总量: ${String(videoPaths.length)} 条`, "info", {
    nodeId: node.id,
    nodeLabel: getGraphNodeLabel(node),
  });

  const generatedFiles: string[] = [];
  const { success, failed } = await deps.runWithConcurrency(videoPaths, maxConcurrent, async (videoPath) => {
    const segmentOutputDir = path.join(outputDir, path.parse(videoPath).name);
    const existingBefore = await deps.listMp4Files(segmentOutputDir).catch(() => []);

    await deps.autoSplitVideoInternal(sender, {
      videoPath,
      outputDir,
      algorithm: splitAlgorithm.algorithm,
      threshold: splitAlgorithm.threshold,
      minDuration: splitAlgorithm.minDuration,
      skipFirst: dropHead,
      skipLast: dropTail,
    });

    const existingAfter = await deps.listMp4Files(segmentOutputDir).catch(() => []);
    const beforeSet = new Set(existingBefore.map((item) => path.resolve(item)));
    const incremental = existingAfter.filter((item) => !beforeSet.has(path.resolve(item)));
    generatedFiles.push(...(incremental.length > 0 ? incremental : existingAfter));
  });

  const uniqueGeneratedFiles = Array.from(new Set(generatedFiles.map((item) => path.resolve(item))));
  const summary =
    failed > 0
      ? `自动拆解完成，成功 ${String(success)} 个，失败 ${String(failed)} 个，生成 ${String(uniqueGeneratedFiles.length)} 个片段`
      : `自动拆解完成，处理 ${String(videoPaths.length)} 个视频，生成 ${String(uniqueGeneratedFiles.length)} 个片段`;
  await deps.appendTaskLog(task.id, summary, "info", {
    nodeId: node.id,
    nodeLabel: getGraphNodeLabel(node),
  });

  return {
    kind: "output",
    output: {
      files: uniqueGeneratedFiles,
      processedCount: videoPaths.length,
      message: summary,
      result: summary,
    },
  };
}
