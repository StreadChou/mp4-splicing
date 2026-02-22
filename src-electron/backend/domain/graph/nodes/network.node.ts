import type { WebContents } from "electron";
import path from "node:path";
import type { WorkflowGraphNode, WorkflowTaskRecord } from "../../../shared/types";
import { asBoolean, asNumber, asString, normalizeNodeOutput } from "../node-execution-helpers";
import type { NodeExecutionDeps, NodeExecutionResult } from "../node-execution";

export async function executeNetworkNode(
  task: WorkflowTaskRecord,
  sender: WebContents,
  node: WorkflowGraphNode,
  payload: Record<string, unknown>,
  config: Record<string, unknown>,
  deps: NodeExecutionDeps,
  defaultOutputKey: string,
): Promise<NodeExecutionResult> {
  const action = asString(config.action) || "batch_download";
  if (action === "batch_download") {
    const outputDir = path.resolve(asString(payload.outputDir || config.outputDir || task.runtimeInput.outputDir || task.runDir));
    await deps.ensureDir(outputDir);
    const urls = Array.isArray(payload.urls)
      ? payload.urls.map((item) => String(item)).filter(Boolean)
      : Array.isArray(payload.items)
        ? payload.items.map((item) => String(item)).filter(Boolean)
        : Array.isArray(payload.result)
          ? payload.result.map((item) => String(item)).filter(Boolean)
          : asString(payload.urlsText || config.urlsText || task.runtimeInput.urlsText)
              .split("\n")
              .map((item) => item.trim())
              .filter(Boolean);
    if (urls.length === 0) {
      throw new Error(`节点 ${node.label} 未提供可下载 URL`);
    }
    const asyncDownload =
      payload.asyncDownload === undefined && config.asyncDownload === undefined
        ? true
        : asBoolean(payload.asyncDownload ?? config.asyncDownload);
    const maxConcurrent = asyncDownload ? Math.max(1, Math.round(asNumber(payload.maxConcurrent || config.maxConcurrent || 3))) : 1;
    const downloadedFiles: string[] = [];
    const { success, failed } = await deps.runWithConcurrency(urls, maxConcurrent, async (url) => {
      const savedPath = await deps.downloadSingleFile(sender, url, outputDir);
      downloadedFiles.push(savedPath);
    });
    return {
      kind: "output",
      output: {
        files: downloadedFiles,
        done: true,
        allSucceeded: failed === 0,
        success,
        failed,
        outputDir,
        [defaultOutputKey]: downloadedFiles,
        result: downloadedFiles,
      },
    };
  }
  return { kind: "output", output: normalizeNodeOutput(node, payload) };
}
