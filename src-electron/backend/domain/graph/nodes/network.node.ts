import type { WebContents } from "electron";
import path from "node:path";
import type { WorkflowGraphNode, WorkflowTaskRecord } from "../../../shared/types";
import { asNumber, getGraphNodeLabel } from "../node-execution-helpers";
import type { NodeExecutionDeps, NodeExecutionResult } from "../node-execution";

function isValidDownloadUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function previewUrl(url: string): string {
  if (url.length <= 72) {
    return url;
  }
  return `${url.slice(0, 69)}...`;
}

function asList(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === undefined || value === null) {
    return [];
  }
  return [value];
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

export async function executeDownloadNode(
  task: WorkflowTaskRecord,
  sender: WebContents,
  node: WorkflowGraphNode,
  payload: Record<string, unknown>,
  config: Record<string, unknown>,
  deps: NodeExecutionDeps,
): Promise<NodeExecutionResult> {
  const outputDir = path.resolve(String(payload.outputDir || config.outputDir || task.runtimeInput.outputDir || task.runDir));
  await deps.ensureDir(outputDir);

  const items = [
    ...asList(payload.item),
    ...asList(payload.items),
    ...asList(payload.result),
    ...asList(task.runtimeInput.item),
    ...asList(task.runtimeInput.items),
  ];

  const textList = items.map((item) => String(item).trim()).filter((item) => item.length > 0);
  if (textList.length === 0) {
    throw new Error(`节点 ${getGraphNodeLabel(node)} 未提供待下载项(item)`);
  }

  const invalid = textList.filter((item) => !isValidDownloadUrl(item));
  if (invalid.length > 0) {
    throw new Error(`节点 ${getGraphNodeLabel(node)} 包含非法下载项: ${invalid.slice(0, 5).join(" | ")}`);
  }

  await deps.appendTaskLog(task.id, `待下载总量: ${String(textList.length)} 条`, "info", {
    nodeId: node.id,
    nodeLabel: getGraphNodeLabel(node),
  });
  for (let start = 0; start < textList.length; start += 10) {
    const end = Math.min(start + 10, textList.length);
    const summary = textList.slice(start, end).map(previewUrl).join(" | ");
    await deps.appendTaskLog(task.id, `${String(end)}/${String(textList.length)} 即将下载: ${summary}`, "info", {
      nodeId: node.id,
      nodeLabel: getGraphNodeLabel(node),
    });
  }

  const maxConcurrent = readLoopConcurrency(payload, config, task.runtimeInput);

  const downloadedFiles: string[] = [];
  const { success, failed } = await deps.runWithConcurrency(textList, maxConcurrent, async (url) => {
    const savedPath = await deps.downloadSingleFile(sender, url, outputDir);
    downloadedFiles.push(savedPath);
  });

  await deps.appendTaskLog(task.id, `下载完成: 成功 ${String(success)}，失败 ${String(failed)}`, "info", {
    nodeId: node.id,
    nodeLabel: getGraphNodeLabel(node),
  });

  return {
    kind: "output",
    output: {
      file: downloadedFiles[0] || "",
      files: downloadedFiles,
      done: true,
      allSucceeded: failed === 0,
      success,
      failed,
      outputDir,
      result: downloadedFiles,
    },
  };
}
