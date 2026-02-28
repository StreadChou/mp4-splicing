import Store from "electron-store";
import type { LicenseKeyProfile, LicenseStoreRecord, LicenseUnlockPayload } from "../../shared/types";

interface LicenseStoreSchema {
  record: LicenseStoreRecord;
  keys: LicenseKeyProfile[];
  activeCode: string;
}

let licenseStore: Store<LicenseStoreSchema> | null = null;

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result = new Set<string>();
  for (const item of value) {
    const normalized = normalizeString(item);
    if (normalized) {
      result.add(normalized);
    }
  }
  return Array.from(result.values());
}

function normalizeUnlockPayload(value: unknown): LicenseUnlockPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const payload = value as Record<string, unknown>;
  const unlock = normalizeString(payload.unlock);
  if (unlock === "all") {
    return { unlock: "all" };
  }

  if (unlock === "workflow") {
    return {
      unlock: "workflow",
      workflows: normalizeStringArray(payload.workflows),
      nodes: normalizeStringArray(payload.nodes),
    };
  }

  return null;
}

function normalizeLicenseStoreRecord(value: unknown): LicenseStoreRecord {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return {
    activationCode: normalizeString(raw.activationCode),
    unlockPayload: normalizeUnlockPayload(raw.unlockPayload),
    lastVerifiedAt: normalizeString(raw.lastVerifiedAt),
    cachedUntil: normalizeString(raw.cachedUntil),
  };
}

function normalizeLicenseKeyProfile(value: unknown): LicenseKeyProfile | null {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const record = normalizeLicenseStoreRecord(raw);
  if (!record.activationCode) {
    return null;
  }
  const statusRaw = normalizeString(raw.status).toLowerCase();
  const status = statusRaw === "invalid" ? "invalid" : "valid";
  return {
    activationCode: record.activationCode,
    unlockPayload: record.unlockPayload,
    lastVerifiedAt: record.lastVerifiedAt,
    cachedUntil: record.cachedUntil,
    status,
  };
}

function normalizeLicenseKeys(value: unknown): LicenseKeyProfile[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const byCode = new Map<string, LicenseKeyProfile>();
  for (const item of value) {
    const profile = normalizeLicenseKeyProfile(item);
    if (profile) {
      byCode.set(profile.activationCode, profile);
    }
  }
  return Array.from(byCode.values());
}

function createEmptyRecord(): LicenseStoreRecord {
  return {
    activationCode: "",
    unlockPayload: null,
    lastVerifiedAt: "",
    cachedUntil: "",
  };
}

function toProfile(record: LicenseStoreRecord): LicenseKeyProfile | null {
  const normalized = normalizeLicenseStoreRecord(record);
  if (!normalized.activationCode) {
    return null;
  }
  return {
    activationCode: normalized.activationCode,
    unlockPayload: normalized.unlockPayload,
    lastVerifiedAt: normalized.lastVerifiedAt,
    cachedUntil: normalized.cachedUntil,
    status: "valid",
  };
}

function getLicenseStore(): Store<LicenseStoreSchema> {
  if (!licenseStore) {
    licenseStore = new Store<LicenseStoreSchema>({
      name: "mp4handler-license",
      defaults: {
        record: createEmptyRecord(),
        keys: [],
        activeCode: "",
      },
    });
  }
  return licenseStore;
}

function normalizeAllStoreFields(): {
  record: LicenseStoreRecord;
  keys: LicenseKeyProfile[];
  activeCode: string;
} {
  const store = getLicenseStore();
  const record = normalizeLicenseStoreRecord(store.get("record"));
  const keys = normalizeLicenseKeys(store.get("keys"));
  let activeCode = normalizeString(store.get("activeCode"));

  let changed = false;
  const profileFromRecord = toProfile(record);
  if (profileFromRecord && !keys.some((item) => item.activationCode === profileFromRecord.activationCode)) {
    keys.push(profileFromRecord);
    changed = true;
  }

  if (!activeCode && record.activationCode) {
    activeCode = record.activationCode;
    changed = true;
  }

  if (activeCode && !keys.some((item) => item.activationCode === activeCode)) {
    activeCode = "";
    changed = true;
  }

  if (changed) {
    store.set("record", record);
    store.set("keys", keys);
    store.set("activeCode", activeCode);
  }

  return {
    record,
    keys,
    activeCode,
  };
}

export function getLicenseRecordFromStore(): LicenseStoreRecord {
  return normalizeAllStoreFields().record;
}

export function setLicenseRecordToStore(record: LicenseStoreRecord): LicenseStoreRecord {
  const store = getLicenseStore();
  const normalized = normalizeLicenseStoreRecord(record);
  store.set("record", normalized);
  return getLicenseRecordFromStore();
}

export function clearLicenseRecordInStore(): LicenseStoreRecord {
  const store = getLicenseStore();
  const empty = createEmptyRecord();
  store.set("record", empty);
  return getLicenseRecordFromStore();
}

export function getLicenseKeysFromStore(): LicenseKeyProfile[] {
  return normalizeAllStoreFields().keys;
}

export function setLicenseKeysToStore(keys: LicenseKeyProfile[]): LicenseKeyProfile[] {
  const store = getLicenseStore();
  const normalized = normalizeLicenseKeys(keys);
  store.set("keys", normalized);
  return getLicenseKeysFromStore();
}

export function getActiveLicenseCodeFromStore(): string {
  return normalizeAllStoreFields().activeCode;
}

export function setActiveLicenseCodeToStore(code: string): string {
  const store = getLicenseStore();
  const normalized = normalizeString(code);
  store.set("activeCode", normalized);
  return getActiveLicenseCodeFromStore();
}
