import type {
  LicenseState,
  LicenseStoreRecord,
  LicenseUnlockPayload,
  WorkflowDefinition,
  WorkflowGraph,
} from "../../shared/types";

const FULL_FEATURE_CODE = "MP4H-ALL-567DEACD80FEB6AC5D6C1599EFE7BA68";
const BATCH_DOWNLOAD_CODE = "MP4H-BATCH-C83C8EC60143249E6BF5D46909563BA1";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export function normalizeActivationCode(value: string): string {
  return value.trim().toUpperCase();
}

export function resolveUnlockPayloadByActivationCode(code: string): LicenseUnlockPayload | null {
  const normalized = normalizeActivationCode(code);
  if (normalized === FULL_FEATURE_CODE) {
    return { unlock: "all" };
  }
  if (normalized === BATCH_DOWNLOAD_CODE) {
    return {
      unlock: "workflow",
      workflows: ["system-batch-download"],
      nodes: [],
    };
  }
  return null;
}

function toNodeTypeSetFromGraph(graph: WorkflowGraph): Set<string> {
  return new Set(
    (Array.isArray(graph.nodes) ? graph.nodes : [])
      .map((node) => (typeof node.type === "string" ? node.type.trim() : ""))
      .filter(Boolean),
  );
}

function collectNodeTypesFromWorkflowIds(workflowIds: string[], workflows: WorkflowDefinition[]): Set<string> {
  const idSet = new Set(workflowIds.map((item) => item.trim()).filter(Boolean));
  const result = new Set<string>();

  for (const workflow of workflows) {
    if (!idSet.has(workflow.id)) {
      continue;
    }
    const workflowNodeTypes = toNodeTypeSetFromGraph(workflow.graph);
    for (const type of workflowNodeTypes) {
      result.add(type);
    }
  }

  return result;
}

export function computeEffectiveAllowedNodeTypes(
  unlockPayload: LicenseUnlockPayload | null,
  workflows: WorkflowDefinition[],
): string[] | null {
  if (!unlockPayload) {
    return [];
  }

  if (unlockPayload.unlock === "all") {
    return null;
  }

  const merged = collectNodeTypesFromWorkflowIds(unlockPayload.workflows, workflows);
  for (const type of unlockPayload.nodes) {
    const normalized = type.trim();
    if (normalized) {
      merged.add(normalized);
    }
  }

  return Array.from(merged.values()).sort((a, b) => a.localeCompare(b));
}

export function isGraphAllowedByNodeTypeSet(graph: WorkflowGraph, allowedNodeTypeSet: Set<string> | null): boolean {
  if (!allowedNodeTypeSet) {
    return true;
  }

  const nodeTypes = toNodeTypeSetFromGraph(graph);
  for (const type of nodeTypes) {
    if (!allowedNodeTypeSet.has(type)) {
      return false;
    }
  }

  return true;
}

function toMs(value: string): number {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

export function createActivatedLicenseRecord(activationCode: string, unlockPayload: LicenseUnlockPayload): LicenseStoreRecord {
  const verifiedAtMs = Date.now();
  const cachedUntilMs = verifiedAtMs + CACHE_TTL_MS;
  return {
    activationCode: normalizeActivationCode(activationCode),
    unlockPayload,
    lastVerifiedAt: new Date(verifiedAtMs).toISOString(),
    cachedUntil: new Date(cachedUntilMs).toISOString(),
  };
}

export function isLicenseRecordActivated(record: LicenseStoreRecord): boolean {
  return Boolean(record.activationCode && record.unlockPayload);
}

export function buildLicenseState(record: LicenseStoreRecord, workflows: WorkflowDefinition[]): LicenseState {
  const activated = isLicenseRecordActivated(record);
  const nowMs = Date.now();
  const cacheValid = activated && toMs(record.cachedUntil) > nowMs;
  const effectiveAllowedNodeTypes = computeEffectiveAllowedNodeTypes(record.unlockPayload, workflows);

  return {
    activated,
    cacheValid,
    needsValidation: activated && !cacheValid,
    lastVerifiedAt: record.lastVerifiedAt,
    cachedUntil: record.cachedUntil,
    unlockPayload: record.unlockPayload,
    effectiveAllowedNodeTypes: activated ? effectiveAllowedNodeTypes : [],
  };
}
