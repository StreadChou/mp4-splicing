const LOCAL_FILE_SCHEME = "mp4handler-file";

function toIpcArgs(args?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (args === undefined) {
    return undefined;
  }
  try {
    // Vue reactive proxy 不能直接走 Electron IPC，这里转成纯 JSON 对象。
    return JSON.parse(JSON.stringify(args)) as Record<string, unknown>;
  } catch {
    return args;
  }
}

export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return window.mp4handler.invoke<T>(command, toIpcArgs(args));
}

export async function openWorkflowEditor(workflowId?: string): Promise<boolean> {
  return window.mp4handler.openWorkflowEditor(workflowId);
}

export async function openTaskInMain(taskId: string): Promise<boolean> {
  return window.mp4handler.openTaskInMain(taskId);
}

export async function windowMinimize(): Promise<boolean> {
  return window.mp4handler.windowMinimize();
}

export async function windowToggleMaximize(): Promise<boolean> {
  return window.mp4handler.windowToggleMaximize();
}

export async function windowClose(): Promise<boolean> {
  return window.mp4handler.windowClose();
}

export async function windowIsMaximized(): Promise<boolean> {
  return window.mp4handler.windowIsMaximized();
}

function encodeLocalPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const withLeadingSlash = normalized.startsWith("/") ? normalized : `/${normalized}`;

  return withLeadingSlash
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export function convertFileSrc(filePath: string): string {
  if (!filePath) {
    return "";
  }

  if (
    filePath.startsWith("http://") ||
    filePath.startsWith("https://") ||
    filePath.startsWith(`${LOCAL_FILE_SCHEME}://`)
  ) {
    return filePath;
  }

  if (filePath.startsWith("file://")) {
    try {
      const parsed = new URL(filePath);
      const decoded = decodeURIComponent(parsed.pathname);
      const normalizedWin = decoded.match(/^\/[A-Za-z]:\//) ? decoded.slice(1) : decoded;
      return `${LOCAL_FILE_SCHEME}://${encodeLocalPath(normalizedWin)}`;
    } catch {
      return filePath;
    }
  }

  return `${LOCAL_FILE_SCHEME}://${encodeLocalPath(filePath)}`;
}
