export interface DialogFilter {
  name: string;
  extensions: string[];
}

export interface OpenDialogOptions {
  directory?: boolean;
  multiple?: boolean;
  title?: string;
  filters?: DialogFilter[];
}

export async function open(options?: OpenDialogOptions): Promise<string | string[] | null> {
  return window.mp4handler.openDialog(options);
}
