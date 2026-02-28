import type { WebContents } from "electron";
import type { InteractionRequest, WorkflowGraphNode, WorkflowTaskRecord } from "../../shared/types";
import { normalizeNodeOutput } from "./node-execution-helpers";
import { getNodeExecutor, runNodeWithExecutor } from "./node-executor-registry";

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
      shuffle?: boolean;
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
  createTaskTempDir(params: { purpose: string; taskId: string; nodeId: string }): Promise<string>;
  cleanupPathQuietly(targetPath: string): Promise<void>;
  appendTaskLog(
    taskId: string,
    message: string,
    level?: "info" | "error" | "warn",
    meta?: { nodeId?: string; nodeLabel?: string },
  ): Promise<void>;
}

export type NodeExecutor = (
  task: WorkflowTaskRecord,
  sender: WebContents,
  node: WorkflowGraphNode,
  payload: Record<string, unknown>,
  config: Record<string, unknown>,
  deps: NodeExecutionDeps,
) => Promise<NodeExecutionResult>;

export async function executeGraphNode(
  task: WorkflowTaskRecord,
  sender: WebContents,
  node: WorkflowGraphNode,
  payload: Record<string, unknown>,
  deps: NodeExecutionDeps,
): Promise<NodeExecutionResult> {
  const executor = getNodeExecutor(node.type);
  if (!executor) {
    return {
      kind: "output",
      output: normalizeNodeOutput(node, payload),
    };
  }
  return runNodeWithExecutor(executor, task, sender, node, payload, deps);
}
