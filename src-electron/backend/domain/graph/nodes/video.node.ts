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

function resolveStrictSinglePath(value: unknown, label: string): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? path.resolve(trimmed) : null;
  }
  if (Array.isArray(value)) {
    const paths = value
      .map((item) => String(item).trim())
      .filter(Boolean)
      .map((item) => path.resolve(item));
    const unique = Array.from(new Set(paths));
    if (unique.length === 0) {
      return null;
    }
    if (unique.length > 1) {
      throw new Error(`auto_split 仅支持单文件输入，${label} 收到 ${String(unique.length)} 个文件，请先接 iterate 节点`);
    }
    return unique[0] as string;
  }
  return null;
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

function resolveAutoSplitVideoPath(
  payload: Record<string, unknown>,
  config: Record<string, unknown>,
  runtimeInput: Record<string, unknown>,
): string {
  const directCandidates: Array<{ value: unknown; label: string }> = [
    { value: payload.file, label: "payload.file" },
    { value: payload.videoPath, label: "payload.videoPath" },
    { value: config.file, label: "config.file" },
    { value: config.videoPath, label: "config.videoPath" },
    { value: runtimeInput.file, label: "runtimeInput.file" },
    { value: runtimeInput.videoPath, label: "runtimeInput.videoPath" },
  ];

  for (const candidate of directCandidates) {
    const resolved = resolveStrictSinglePath(candidate.value, candidate.label);
    if (resolved) {
      return resolved;
    }
  }

  const fallbackPaths = Array.from(
    new Set([
      ...asPathList(payload.files),
      ...asPathList(payload.result),
      ...asPathList(runtimeInput.files),
      ...asSinglePath(payload.files),
      ...asSinglePath(payload.result),
      ...asSinglePath(runtimeInput.files),
    ]),
  );

  if (fallbackPaths.length === 1) {
    return fallbackPaths[0] as string;
  }
  if (fallbackPaths.length > 1) {
    throw new Error(`auto_split 仅支持单文件输入，当前收到 ${String(fallbackPaths.length)} 个文件，请先接 iterate 节点`);
  }

  throw new Error("auto_split 缺少可处理视频(file/videoPath)");
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
  const videoPath = resolveAutoSplitVideoPath(payload, config, task.runtimeInput);

  const splitAlgorithm = readSplitAlgorithm(payload, config, task.runtimeInput);
  const dropHead = asBoolean(payload.dropHead ?? config.dropHead ?? task.runtimeInput.dropHead ?? false);
  const dropTail = asBoolean(payload.dropTail ?? config.dropTail ?? task.runtimeInput.dropTail ?? false);

  await deps.appendTaskLog(task.id, `自动拆解输入视频: ${path.basename(videoPath)}`, "info", {
    nodeId: node.id,
    nodeLabel: getGraphNodeLabel(node),
  });

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
  const generatedFiles = incremental.length > 0 ? incremental : existingAfter;
  const uniqueGeneratedFiles = Array.from(new Set(generatedFiles.map((item) => path.resolve(item))));
  const summary = `自动拆解完成，生成 ${String(uniqueGeneratedFiles.length)} 个片段`;
  await deps.appendTaskLog(task.id, summary, "info", {
    nodeId: node.id,
    nodeLabel: getGraphNodeLabel(node),
  });

  return {
    kind: "output",
    output: {
      files: uniqueGeneratedFiles,
      processedCount: 1,
      message: summary,
      result: summary,
    },
  };
}
