declare namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV: string;
    VUE_ROUTER_MODE: "hash" | "history" | "abstract" | undefined;
    VUE_ROUTER_BASE: string | undefined;
  }
}

declare global {
  interface Window {
    mp4handler: {
      invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
      openDialog(options?: {
        directory?: boolean;
        multiple?: boolean;
        title?: string;
        filters?: Array<{ name: string; extensions: string[] }>;
      }): Promise<string | string[] | null>;
      openWorkflowEditor(workflowId?: string): Promise<boolean>;
      openTaskInMain(taskId: string): Promise<boolean>;
      windowMinimize(): Promise<boolean>;
      windowToggleMaximize(): Promise<boolean>;
      windowClose(): Promise<boolean>;
      windowIsMaximized(): Promise<boolean>;
      on(eventName: string, callback: (payload: unknown) => void): () => void;
    };
  }
}

export {};
