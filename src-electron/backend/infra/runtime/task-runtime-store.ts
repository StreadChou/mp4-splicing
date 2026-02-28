import { app } from "electron";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { type TaskRuntimeSnapshot } from "../../shared/types";

const RUNTIME_READ_RETRY_MS = 25;
const RUNTIME_READ_RETRY_TIMES = 2;

function getTaskRuntimeBaseDir(): string {
  return path.join(app.getPath("userData"), "taskRuntime");
}

function getTaskRuntimeFile(taskId: string): string {
  return path.join(getTaskRuntimeBaseDir(), `${taskId}.json`);
}

async function ensureDir(dirPath: string): Promise<void> {
  await fsp.mkdir(dirPath, { recursive: true });
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await fsp.access(targetPath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function createEmptyRuntime(): TaskRuntimeSnapshot {
  return {
    phase: "",
    context: {},
    logs: [],
    interaction: null,
  };
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function readTaskRuntime(taskId: string): Promise<TaskRuntimeSnapshot> {
  const filePath = getTaskRuntimeFile(taskId);
  if (!(await fileExists(filePath))) {
    return createEmptyRuntime();
  }

  for (let attempt = 0; attempt <= RUNTIME_READ_RETRY_TIMES; attempt += 1) {
    const content = await fsp.readFile(filePath, "utf8");
    const trimmed = content.trim();
    if (!trimmed) {
      if (attempt < RUNTIME_READ_RETRY_TIMES) {
        await delay(RUNTIME_READ_RETRY_MS);
        continue;
      }
      return createEmptyRuntime();
    }

    try {
      const parsed = JSON.parse(trimmed) as Partial<TaskRuntimeSnapshot>;
      if (!parsed || typeof parsed !== "object") {
        return createEmptyRuntime();
      }
      return {
        phase: typeof parsed.phase === "string" ? parsed.phase : "",
        context: parsed.context && typeof parsed.context === "object" ? (parsed.context as Record<string, unknown>) : {},
        logs: Array.isArray(parsed.logs) ? parsed.logs : [],
        interaction: parsed.interaction ?? null,
      };
    } catch {
      if (attempt < RUNTIME_READ_RETRY_TIMES) {
        await delay(RUNTIME_READ_RETRY_MS);
        continue;
      }
      return createEmptyRuntime();
    }
  }

  return createEmptyRuntime();
}

export async function writeTaskRuntime(taskId: string, runtime: TaskRuntimeSnapshot): Promise<void> {
  await ensureDir(getTaskRuntimeBaseDir());
  await fsp.writeFile(getTaskRuntimeFile(taskId), JSON.stringify(runtime, null, 2), "utf8");
}

export async function deleteTaskRuntime(taskId: string): Promise<void> {
  await fsp.rm(getTaskRuntimeFile(taskId), { force: true }).catch(() => void 0);
}

export async function clearAllTaskRuntime(): Promise<void> {
  await fsp.rm(getTaskRuntimeBaseDir(), { recursive: true, force: true }).catch(() => void 0);
}
