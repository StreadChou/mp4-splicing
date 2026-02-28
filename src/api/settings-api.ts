import { invoke } from "src/tauri-compat/core";
import type { AppSettings } from "src/components/workflow/types";

export async function getAppSettings(): Promise<AppSettings> {
  return invoke<AppSettings>("settings:get");
}

export async function updateAppSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  return invoke<AppSettings>("settings:update", patch);
}
