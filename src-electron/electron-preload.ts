import { contextBridge, ipcRenderer } from "electron";

type EventCallback = (payload: unknown) => void;

const listeners = new Map<string, Set<EventCallback>>();

ipcRenderer.on("mp4handler:event", (_event, message: { event: string; payload: unknown }) => {
  const callbacks = listeners.get(message.event);
  if (!callbacks) {
    return;
  }

  for (const callback of callbacks) {
    callback(message.payload);
  }
});

contextBridge.exposeInMainWorld("mp4handler", {
  invoke: <T>(command: string, args?: Record<string, unknown>) => {
    return ipcRenderer.invoke("mp4handler:invoke", command, args ?? {}) as Promise<T>;
  },

  openDialog: (options?: {
    directory?: boolean;
    multiple?: boolean;
    title?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
  }) => {
    return ipcRenderer.invoke("mp4handler:open-dialog", options ?? {});
  },

  openWorkflowEditor: (workflowId?: string) => {
    return ipcRenderer.invoke("mp4handler:open-workflow-editor", workflowId ?? null);
  },

  openTaskInMain: (taskId: string) => {
    return ipcRenderer.invoke("mp4handler:open-task", taskId);
  },

  windowMinimize: () => {
    return ipcRenderer.invoke("mp4handler:window-minimize") as Promise<boolean>;
  },

  windowToggleMaximize: () => {
    return ipcRenderer.invoke("mp4handler:window-toggle-maximize") as Promise<boolean>;
  },

  windowClose: () => {
    return ipcRenderer.invoke("mp4handler:window-close") as Promise<boolean>;
  },

  windowIsMaximized: () => {
    return ipcRenderer.invoke("mp4handler:window-is-maximized") as Promise<boolean>;
  },

  on: (eventName: string, callback: EventCallback) => {
    const callbackSet = listeners.get(eventName) ?? new Set<EventCallback>();
    callbackSet.add(callback);
    listeners.set(eventName, callbackSet);

    return () => {
      const set = listeners.get(eventName);
      if (!set) {
        return;
      }
      set.delete(callback);
      if (set.size === 0) {
        listeners.delete(eventName);
      }
    };
  },
});
