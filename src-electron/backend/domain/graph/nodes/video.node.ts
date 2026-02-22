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

function firstDefined(values: unknown[]): unknown {
  for (const value of values) {
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
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

function previewPath(value: string): string {
  const name = path.basename(value.trim());
  if (!name) {
    return value.trim();
  }
  return name;
}

export async function executeVideoNode(
  task: WorkflowTaskRecord,
  sender: WebContents,
  node: WorkflowGraphNode,
  payload: Record<string, unknown>,
  config: Record<string, unknown>,
  deps: NodeExecutionDeps,
  defaultOutputKey: string,
): Promise<NodeExecutionResult> {
  const action = asString(config.action) || "auto_split";
  const splitConfig = readSplitConfig(payload.splitConfig, config.splitConfig, task.runtimeInput.splitConfig);

  if (action === "concat") {
    const candidateFiles = [
      ...(Array.isArray(payload.files) ? payload.files : []),
      ...(Array.isArray(payload.video) ? payload.video : []),
      ...(Array.isArray(payload.result) ? payload.result : []),
      ...(Array.isArray(task.runtimeInput.files) ? task.runtimeInput.files : []),
    ]
      .map((item) => String(item).trim())
      .filter((item) => item.length > 0);

    const uniqueFiles = Array.from(new Set(candidateFiles));
    if (uniqueFiles.length > 0) {
      await deps.appendTaskLog(task.id, `候选视频总量: ${String(uniqueFiles.length)} 条`, "info", {
        nodeId: node.id,
        nodeLabel: node.label,
      });
      for (let start = 0; start < uniqueFiles.length; start += 10) {
        const end = Math.min(start + 10, uniqueFiles.length);
        const summary = uniqueFiles
          .slice(start, end)
          .map((item) => previewPath(item))
          .join(" | ");
        await deps.appendTaskLog(task.id, `${String(end)}/${String(uniqueFiles.length)} 即将使用: ${summary}`, "info", {
          nodeId: node.id,
          nodeLabel: node.label,
        });
      }
    }
    let inputDir = asString(payload.inputDir || config.inputDir || task.runtimeInput.inputDir);
    if (!inputDir && uniqueFiles.length > 0 && !splitConfig.forceInputDir) {
      const parentDirs = Array.from(new Set(uniqueFiles.map((item) => path.dirname(item))));
      if (parentDirs.length === 1) {
        inputDir = parentDirs[0] as string;
        await deps.appendTaskLog(task.id, `节点 ${node.label} 未显式配置 inputDir，已根据连线文件自动推断目录: ${inputDir}`, "warn");
      }
    }

    if (!inputDir && uniqueFiles.length === 0) {
      throw new Error(`节点 ${node.label} 缺少 inputDir 或候选视频(files)`);
    }

    const outputDir = path.resolve(asString(payload.outputDir || config.outputDir || task.runtimeInput.outputDir || task.runDir));
    await deps.ensureDir(outputDir);
    const concatParams = {
      inputDir,
      startingVideo: pickSinglePath(
        payload.startVideo,
        payload.startingVideo,
        config.startVideo,
        config.startingVideo,
        task.runtimeInput.startVideo,
        task.runtimeInput.startingVideo,
      ) || null,
      endingVideo: pickSinglePath(
        payload.endVideo,
        payload.endingVideo,
        config.endVideo,
        config.endingVideo,
        task.runtimeInput.endVideo,
        task.runtimeInput.endingVideo,
      ) || null,
      randomCountMin: Math.max(1, Math.round(asNumber(payload.randomCountMin || config.randomCountMin || task.runtimeInput.randomCountMin || 2))),
      randomCountMax: Math.max(1, Math.round(asNumber(payload.randomCountMax || config.randomCountMax || task.runtimeInput.randomCountMax || 4))),
      maxDepth: Math.max(0, Math.round(asNumber(payload.maxDepth || config.maxDepth || task.runtimeInput.maxDepth || 2))),
      runTimes: Math.max(1, Math.round(asNumber(payload.runTimes || config.runTimes || task.runtimeInput.runTimes || 1))),
      outputDir,
      ...(uniqueFiles.length > 0 ? { files: uniqueFiles } : {}),
    };
    const result = await deps.concatVideosInternal(sender, concatParams);
    return {
      kind: "output",
      output: {
        files: result.outputPaths,
        message: result.message,
        splitConfig: {},
        [defaultOutputKey]: result.message,
        result: result.message,
      },
    };
  }

  if (action === "split_profile") {
    const thresholdRaw = firstDefined([payload.threshold, splitConfig.threshold, config.threshold, task.runtimeInput.threshold]);
    const minDurationRaw = firstDefined([
      payload.minDuration,
      splitConfig.minDuration,
      config.minDuration,
      task.runtimeInput.minDuration,
    ]);
    const skipFirstRaw = firstDefined([payload.skipFirst, splitConfig.skipFirst, config.skipFirst, task.runtimeInput.skipFirst]);
    const skipLastRaw = firstDefined([payload.skipLast, splitConfig.skipLast, config.skipLast, task.runtimeInput.skipLast]);

    const normalizedSplitConfig = {
      algorithm: asString(firstDefined([payload.algorithm, splitConfig.algorithm, config.algorithm, task.runtimeInput.algorithm]) || "ssim"),
      threshold: asNumber(thresholdRaw === undefined ? 0.7 : thresholdRaw),
      minDuration: asNumber(minDurationRaw === undefined ? 2 : minDurationRaw),
      skipFirst: asBoolean(skipFirstRaw),
      skipLast: skipLastRaw === undefined ? true : asBoolean(skipLastRaw),
    };
    const summary = "已生成拆解参数";

    return {
      kind: "output",
      output: {
        splitConfig: normalizedSplitConfig,
        files: [],
        [defaultOutputKey]: summary,
        result: summary,
      },
    };
  }

  if (action === "auto_split") {
    const outputDir = path.resolve(asString(payload.outputDir || config.outputDir || task.runtimeInput.outputDir || task.runDir));
    await deps.ensureDir(outputDir);
    let videoPaths: string[] = [];
    if (Array.isArray(payload.files)) {
      videoPaths = payload.files.map((item) => String(item)).filter(Boolean);
    } else if (Array.isArray(payload.result)) {
      videoPaths = payload.result.map((item) => String(item)).filter(Boolean);
    } else if (payload.videoPath) {
      videoPaths = [asString(payload.videoPath)];
    } else if (task.runtimeInput.videoPath) {
      videoPaths = [asString(task.runtimeInput.videoPath)];
    }
    if (videoPaths.length === 0) {
      throw new Error(`节点 ${node.label} 缺少可处理视频(files/videoPath)`);
    }
    await deps.appendTaskLog(task.id, `待自动拆解视频总量: ${String(videoPaths.length)} 条`, "info", {
      nodeId: node.id,
      nodeLabel: node.label,
    });
    for (let start = 0; start < videoPaths.length; start += 10) {
      const end = Math.min(start + 10, videoPaths.length);
      const summary = videoPaths
        .slice(start, end)
        .map((item) => previewPath(item))
        .join(" | ");
      await deps.appendTaskLog(task.id, `${String(end)}/${String(videoPaths.length)} 即将拆解: ${summary}`, "info", {
        nodeId: node.id,
        nodeLabel: node.label,
      });
    }
    const thresholdRaw = firstDefined([payload.threshold, splitConfig.threshold, config.threshold, task.runtimeInput.threshold]);
    const minDurationRaw = firstDefined([
      payload.minDuration,
      splitConfig.minDuration,
      config.minDuration,
      task.runtimeInput.minDuration,
    ]);
    const skipFirstRaw = firstDefined([payload.skipFirst, splitConfig.skipFirst, config.skipFirst, task.runtimeInput.skipFirst]);
    const skipLastRaw = firstDefined([payload.skipLast, splitConfig.skipLast, config.skipLast, task.runtimeInput.skipLast]);
    const normalizedSplitConfig = {
      algorithm: asString(firstDefined([payload.algorithm, splitConfig.algorithm, config.algorithm, task.runtimeInput.algorithm]) || "ssim"),
      threshold: asNumber(thresholdRaw === undefined ? 0.7 : thresholdRaw),
      minDuration: asNumber(minDurationRaw === undefined ? 2 : minDurationRaw),
      skipFirst: asBoolean(skipFirstRaw),
      skipLast: skipLastRaw === undefined ? true : asBoolean(skipLastRaw),
    };

    const generatedFiles: string[] = [];
    for (const videoPath of videoPaths) {
      const segmentOutputDir = path.join(outputDir, path.parse(videoPath).name);
      const existingBefore = await deps.listMp4Files(segmentOutputDir).catch(() => []);
      await deps.autoSplitVideoInternal(sender, {
        videoPath,
        outputDir,
        algorithm: normalizedSplitConfig.algorithm,
        threshold: normalizedSplitConfig.threshold,
        minDuration: normalizedSplitConfig.minDuration,
        skipFirst: normalizedSplitConfig.skipFirst,
        skipLast: normalizedSplitConfig.skipLast,
      });
      const existingAfter = await deps.listMp4Files(segmentOutputDir).catch(() => []);
      const beforeSet = new Set(existingBefore.map((item) => path.resolve(item)));
      const incremental = existingAfter.filter((item) => !beforeSet.has(path.resolve(item)));
      generatedFiles.push(...(incremental.length > 0 ? incremental : existingAfter));
    }

    const uniqueGeneratedFiles = Array.from(new Set(generatedFiles.map((item) => path.resolve(item))));
    const summary = `自动拆解完成，处理 ${String(videoPaths.length)} 个视频，生成 ${String(uniqueGeneratedFiles.length)} 个片段`;
    await deps.appendTaskLog(task.id, summary, "info", {
      nodeId: node.id,
      nodeLabel: node.label,
    });
    return {
      kind: "output",
      output: {
        files: uniqueGeneratedFiles,
        processedCount: videoPaths.length,
        splitConfig: normalizedSplitConfig,
        message: summary,
        [defaultOutputKey]: summary,
        result: summary,
      },
    };
  }

  if (action === "remove_ending") {
    const outputDir = path.resolve(asString(payload.outputDir || config.outputDir || task.runtimeInput.outputDir || task.runDir));
    await deps.ensureDir(outputDir);
    let videoPaths: string[] = [];
    if (Array.isArray(payload.files)) {
      videoPaths = payload.files.map((item) => String(item)).filter(Boolean);
    } else if (payload.videoPath) {
      videoPaths = [asString(payload.videoPath)];
    } else {
      const inputDir = asString(payload.inputDir || config.inputDir || task.runtimeInput.inputDir);
      if (inputDir) {
        videoPaths = await deps.listMp4Files(inputDir);
      }
    }
    if (videoPaths.length === 0) {
      throw new Error(`节点 ${node.label} 缺少可处理视频`);
    }
    await deps.appendTaskLog(task.id, `待去结尾视频总量: ${String(videoPaths.length)} 条`, "info", {
      nodeId: node.id,
      nodeLabel: node.label,
    });
    for (let start = 0; start < videoPaths.length; start += 10) {
      const end = Math.min(start + 10, videoPaths.length);
      const summary = videoPaths
        .slice(start, end)
        .map((item) => previewPath(item))
        .join(" | ");
      await deps.appendTaskLog(task.id, `${String(end)}/${String(videoPaths.length)} 即将处理: ${summary}`, "info", {
        nodeId: node.id,
        nodeLabel: node.label,
      });
    }

    const thresholdRaw = firstDefined([payload.threshold, splitConfig.threshold, config.threshold, task.runtimeInput.threshold]);
    const minDurationRaw = firstDefined([
      payload.minDuration,
      splitConfig.minDuration,
      config.minDuration,
      task.runtimeInput.minDuration,
    ]);
    const shuffleRaw = firstDefined([
      payload.shuffleSegments,
      splitConfig.shuffleSegments,
      config.shuffleSegments,
      task.runtimeInput.shuffleSegments,
    ]);

    for (const videoPath of videoPaths) {
      await deps.removeEndingAndConcatInternal(sender, {
        videoPath,
        outputDir,
        algorithm: asString(firstDefined([payload.algorithm, splitConfig.algorithm, config.algorithm, task.runtimeInput.algorithm]) || "ssim"),
        threshold: asNumber(thresholdRaw === undefined ? 0.7 : thresholdRaw),
        minDuration: asNumber(minDurationRaw === undefined ? 2 : minDurationRaw),
        newEndingVideo:
          payload.newEndingVideo || config.newEndingVideo || task.runtimeInput.newEndingVideo
            ? asString(payload.newEndingVideo || config.newEndingVideo || task.runtimeInput.newEndingVideo)
            : null,
        shuffleSegments: asBoolean(shuffleRaw),
      });
    }
    await deps.appendTaskLog(task.id, `去结尾处理完成: ${String(videoPaths.length)} 条`, "info", {
      nodeId: node.id,
      nodeLabel: node.label,
    });
    return {
      kind: "output",
      output: { files: [], processedCount: videoPaths.length, [defaultOutputKey]: videoPaths.length, result: videoPaths.length },
    };
  }

  if (action === "split_segments") {
    const videoPath = asString(payload.videoPath || config.videoPath || task.runtimeInput.videoPath);
    if (!videoPath) {
      throw new Error(`节点 ${node.label} 缺少 videoPath`);
    }
    const outputDir = asString(payload.outputDir || config.outputDir || task.runtimeInput.outputDir || path.dirname(videoPath));
    const segments = deps.parseSegmentsFromPayload(payload);
    if (segments.length === 0) {
      throw new Error(`节点 ${node.label} 缺少 segments`);
    }
    const message = await deps.generateVideoSegmentsInternal(sender, videoPath, segments, outputDir);
    return { kind: "output", output: { files: [], message, [defaultOutputKey]: message, result: message } };
  }

  return { kind: "output", output: normalizeNodeOutput(node, payload) };
}
