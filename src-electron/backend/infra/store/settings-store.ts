import { app } from "electron";
import os from "node:os";
import path from "node:path";
import Store from "electron-store";
import type { AppSettings } from "../../shared/types";

let settingsStore: Store<AppSettings> | null = null;

function resolveLegacyDefaultTempRootDir(): string {
  if (app.isReady()) {
    return path.join(app.getPath("userData"), "temp-workdirs");
  }
  return path.resolve(process.cwd(), ".mp4handler-temp");
}

function resolveSystemTempRootDir(): string {
  return path.resolve(path.join(os.tmpdir(), "mp4handler-temp-workdirs"));
}

function normalizeStoredTempRootDir(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return path.resolve(trimmed);
}

function resolveEffectiveTempRootDir(rawStoredValue: unknown): string {
  const normalized = normalizeStoredTempRootDir(rawStoredValue);
  if (!normalized) {
    return resolveSystemTempRootDir();
  }

  const legacyDefault = path.resolve(resolveLegacyDefaultTempRootDir());
  if (normalized === legacyDefault) {
    return resolveSystemTempRootDir();
  }

  return normalized;
}

function getSettingsStore(): Store<AppSettings> {
  if (!settingsStore) {
    settingsStore = new Store<AppSettings>({
      name: "mp4handler-settings",
      defaults: {
        // 空字符串表示“未设置”，运行时自动走系统临时目录。
        tempRootDir: "",
      },
    });
  }
  return settingsStore;
}

export function getSettingsFromStore(): AppSettings {
  const store = getSettingsStore();
  const rawStored = store.get("tempRootDir");
  const normalizedStored = normalizeStoredTempRootDir(rawStored);

  // 兼容旧版本默认值：迁移为“未设置”语义，改用系统临时目录。
  const legacyDefault = path.resolve(resolveLegacyDefaultTempRootDir());
  if (normalizedStored === legacyDefault) {
    store.set("tempRootDir", "");
  } else if (typeof rawStored !== "string" || rawStored !== normalizedStored) {
    store.set("tempRootDir", normalizedStored);
  }

  const tempRootDir = resolveEffectiveTempRootDir(store.get("tempRootDir"));
  return {
    tempRootDir,
  };
}

export function updateSettingsInStore(patch: Partial<AppSettings>): AppSettings {
  const store = getSettingsStore();
  if (patch.tempRootDir !== undefined) {
    // 允许写入空值：表示恢复为系统临时目录。
    store.set("tempRootDir", normalizeStoredTempRootDir(patch.tempRootDir));
  }
  return getSettingsFromStore();
}
