import { app, BrowserWindow, dialog, ipcMain, protocol, screen } from "electron";
import path from "path";
import os from "os";
import fsp from "node:fs/promises";
import { fileURLToPath } from "url";
import { invokeMp4Command } from "./mp4handler-backend";

const platform = process.platform || os.platform();
const currentDir = fileURLToPath(new URL(".", import.meta.url));
const LOCAL_FILE_SCHEME = "mp4handler-file";

protocol.registerSchemesAsPrivileged([
  {
    scheme: LOCAL_FILE_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

let mainWindow: BrowserWindow | undefined;
const workflowEditorWindows = new Set<BrowserWindow>();

function normalizeHashPath(value?: string): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    return "/";
  }
  return raw.startsWith("/") ? raw : `/${raw}`;
}

async function loadRendererRoute(targetWindow: BrowserWindow, hashPath?: string): Promise<void> {
  const normalized = normalizeHashPath(hashPath);
  if (process.env.DEV) {
    await targetWindow.loadURL(`${process.env.APP_URL}#${normalized}`);
  } else {
    await targetWindow.loadFile("index.html", { hash: normalized });
  }
}

function emitWindowState(targetWindow: BrowserWindow) {
  if (targetWindow.isDestroyed()) {
    return;
  }
  targetWindow.webContents.send("mp4handler:event", {
    event: "window:state",
    payload: {
      maximized: targetWindow.isMaximized(),
    },
  });
}

function bindWindowStateEvents(targetWindow: BrowserWindow) {
  targetWindow.on("maximize", () => {
    emitWindowState(targetWindow);
  });
  targetWindow.on("unmaximize", () => {
    emitWindowState(targetWindow);
  });
  targetWindow.on("enter-full-screen", () => {
    emitWindowState(targetWindow);
  });
  targetWindow.on("leave-full-screen", () => {
    emitWindowState(targetWindow);
  });
}

function getMimeType(targetPath: string): string {
  const ext = path.extname(targetPath).toLowerCase();
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".bmp":
      return "image/bmp";
    case ".svg":
      return "image/svg+xml";
    case ".mp4":
      return "video/mp4";
    default:
      return "application/octet-stream";
  }
}

function resolveLocalFilePath(requestUrl: string): string {
  const url = new URL(requestUrl);
  const hostPart = url.host ? `/${url.host}` : "";
  let decodedPath = decodeURIComponent(`${hostPart}${url.pathname}`);

  if (platform === "win32") {
    if (/^\/[A-Za-z]:\//.test(decodedPath)) {
      decodedPath = decodedPath.slice(1);
    }
  }

  return decodedPath;
}

async function registerLocalFileProtocol() {
  protocol.handle(LOCAL_FILE_SCHEME, async (request) => {
    try {
      const targetPath = resolveLocalFilePath(request.url);
      const content = await fsp.readFile(targetPath);

      return new Response(content, {
        headers: {
          "Content-Type": getMimeType(targetPath),
          "Cache-Control": "no-cache",
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return new Response(`加载本地资源失败: ${message}`, {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  });
}

async function createWindow(hashPath?: string) {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    icon: path.resolve(currentDir, "icons/icon.png"),
    frame: false,
    width: screenWidth,
    height: screenHeight,
    minWidth: 1100,
    minHeight: 720,
    useContentSize: true,
    webPreferences: {
      contextIsolation: true,
      preload: path.resolve(
        currentDir,
        path.join(
          process.env.QUASAR_ELECTRON_PRELOAD_FOLDER,
          "electron-preload" + process.env.QUASAR_ELECTRON_PRELOAD_EXTENSION,
        ),
      ),
    },
  });

  await loadRendererRoute(mainWindow, hashPath);

  mainWindow.maximize();
  bindWindowStateEvents(mainWindow);
  emitWindowState(mainWindow);

  if (process.env.DEBUGGING) {
    mainWindow.webContents.openDevTools({ mode: "right" });
  } else {
    mainWindow.webContents.on("devtools-opened", () => {
      mainWindow?.webContents.closeDevTools();
    });
  }

  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
}

async function createWorkflowEditorWindow(workflowId?: string) {
  const encodedId = workflowId ? encodeURIComponent(workflowId) : "new";
  const hashPath = `/workflow-editor/${encodedId}`;

  const editorWindow = new BrowserWindow({
    icon: path.resolve(currentDir, "icons/icon.png"),
    frame: false,
    width: 1600,
    height: 980,
    minWidth: 1280,
    minHeight: 760,
    webPreferences: {
      contextIsolation: true,
      preload: path.resolve(
        currentDir,
        path.join(
          process.env.QUASAR_ELECTRON_PRELOAD_FOLDER,
          "electron-preload" + process.env.QUASAR_ELECTRON_PRELOAD_EXTENSION,
        ),
      ),
    },
  });

  editorWindow.maximize();
  bindWindowStateEvents(editorWindow);
  emitWindowState(editorWindow);

  await loadRendererRoute(editorWindow, hashPath);

  if (process.env.DEBUGGING) {
    editorWindow.webContents.openDevTools({ mode: "right" });
  }

  workflowEditorWindows.add(editorWindow);
  editorWindow.on("closed", () => {
    workflowEditorWindows.delete(editorWindow);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("mp4handler:event", {
        event: "ui:workflow-list-refresh",
        payload: {},
      });
    }
  });
}

function closeAllEditorWindows(): void {
  for (const editorWindow of Array.from(workflowEditorWindows)) {
    workflowEditorWindows.delete(editorWindow);
    if (!editorWindow.isDestroyed()) {
      editorWindow.destroy();
    }
  }
}

ipcMain.handle("mp4handler:invoke", async (event, command: string, args?: Record<string, unknown>) => {
  try {
    return await invokeMp4Command(event.sender, command, args ?? {});
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message);
  }
});

ipcMain.handle("mp4handler:open-workflow-editor", async (_event, workflowId?: string) => {
  await createWorkflowEditorWindow(workflowId);
  return true;
});

ipcMain.handle("mp4handler:open-task", async (_event, taskId?: string) => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    await createWindow("/");
  }

  if (!mainWindow) {
    return false;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();

  const normalizedTaskId = typeof taskId === "string" ? taskId.trim() : "";
  if (normalizedTaskId) {
    mainWindow.webContents.send("mp4handler:event", {
      event: "ui:open-task",
      payload: { taskId: normalizedTaskId },
    });
  }

  return true;
});

ipcMain.handle("mp4handler:license-kick-to-activate", async (event, reason?: string) => {
  const ownerWindow = BrowserWindow.fromWebContents(event.sender) ?? null;
  const dialogWindow = ownerWindow && !ownerWindow.isDestroyed()
    ? ownerWindow
    : (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null);
  const detail = typeof reason === "string" && reason.trim()
    ? reason.trim()
    : "授权验证未通过，请重新输入激活码。";

  const dialogOptions = {
    type: "warning" as const,
    title: "授权失效",
    message: "授权验证失败",
    detail,
    buttons: ["确定"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  };

  if (dialogWindow) {
    await dialog.showMessageBox(dialogWindow, dialogOptions);
  } else {
    await dialog.showMessageBox(dialogOptions);
  }

  closeAllEditorWindows();

  if (!mainWindow || mainWindow.isDestroyed()) {
    await createWindow("/activate");
    return true;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  await loadRendererRoute(mainWindow, "/activate");
  mainWindow.show();
  mainWindow.focus();
  return true;
});

ipcMain.handle(
  "mp4handler:open-dialog",
  async (
    event,
    options?: {
      directory?: boolean;
      multiple?: boolean;
      title?: string;
      filters?: Array<{ name: string; extensions: string[] }>;
    },
  ) => {
    const ownerWindow = BrowserWindow.fromWebContents(event.sender) ?? null;
    const properties: Array<"openDirectory" | "openFile" | "multiSelections"> = [];

    if (options?.directory) {
      properties.push("openDirectory");
    } else {
      properties.push("openFile");
    }

    if (options?.multiple) {
      properties.push("multiSelections");
    }

    const dialogOptions: {
      title?: string;
      properties: Array<"openDirectory" | "openFile" | "multiSelections">;
      filters?: Array<{ name: string; extensions: string[] }>;
    } = {
      properties,
    };
    if (options?.title) {
      dialogOptions.title = options.title;
    }
    if (options?.filters) {
      dialogOptions.filters = options.filters;
    }

    const result = ownerWindow
      ? await dialog.showOpenDialog(ownerWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    if (options?.multiple) {
      return result.filePaths;
    }

    return result.filePaths[0] ?? null;
  },
);

ipcMain.handle("mp4handler:window-minimize", (event) => {
  const ownerWindow = BrowserWindow.fromWebContents(event.sender);
  if (!ownerWindow || ownerWindow.isDestroyed()) {
    return false;
  }
  ownerWindow.minimize();
  emitWindowState(ownerWindow);
  return true;
});

ipcMain.handle("mp4handler:window-toggle-maximize", (event) => {
  const ownerWindow = BrowserWindow.fromWebContents(event.sender);
  if (!ownerWindow || ownerWindow.isDestroyed()) {
    return false;
  }
  if (ownerWindow.isMaximized()) {
    ownerWindow.unmaximize();
  } else {
    ownerWindow.maximize();
  }
  emitWindowState(ownerWindow);
  return true;
});

ipcMain.handle("mp4handler:window-close", (event) => {
  const ownerWindow = BrowserWindow.fromWebContents(event.sender);
  if (!ownerWindow || ownerWindow.isDestroyed()) {
    return false;
  }
  ownerWindow.close();
  return true;
});

ipcMain.handle("mp4handler:window-is-maximized", (event) => {
  const ownerWindow = BrowserWindow.fromWebContents(event.sender);
  if (!ownerWindow || ownerWindow.isDestroyed()) {
    return false;
  }
  return ownerWindow.isMaximized();
});

void app.whenReady().then(async () => {
  await registerLocalFileProtocol();
  await createWindow("/");
});

app.on("window-all-closed", () => {
  if (platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (mainWindow === undefined) {
    void createWindow("/");
  }
});
