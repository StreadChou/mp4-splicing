import crypto from "node:crypto";
import { normalizeWorkflowGraph, validateWorkflowGraphStructure, validateWorkflowRunConfig } from "../graph/graph-schema";
import {
  buildLicenseState,
  createActivatedLicenseRecord,
  isGraphAllowedByNodeTypeSet,
  normalizeActivationCode,
  resolveUnlockPayloadByActivationCode,
} from "../license/mock-license";
import type {
  AppSettings,
  LicenseActivationResult,
  LicenseBackgroundValidateResult,
  LicenseKeyProfile,
  LicenseKeysResult,
  LicenseState,
  LicenseStoreRecord,
  TaskRuntimeSnapshot,
  WorkflowDefinition,
  WorkflowGraph,
  WorkflowMeta,
  WorkflowTaskRecord,
} from "../../shared/types";
import { WORKFLOW_SCHEMA_VERSION } from "../../shared/types";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string") {
        return item;
      }
    }
  }
  return "";
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item)).map((item) => item.trim()).filter(Boolean);
}

function normalizeRemark(value: unknown): string {
  return asString(value).trim();
}

function normalizeHandle(value: unknown): string {
  return asString(value).trim();
}

function buildNodeSignatureMap(graph: WorkflowGraph): Map<string, { type: string; remark: string }> {
  return new Map(
    graph.nodes.map((node) => [
      node.id,
      {
        type: node.type,
        remark: normalizeRemark(node.remark),
      },
    ] as const),
  );
}

function buildEdgeSignatures(graph: WorkflowGraph): string[] {
  return graph.edges
    .map((edge) => [edge.source, edge.target, normalizeHandle(edge.sourceHandle), normalizeHandle(edge.targetHandle)].join("::"))
    .sort();
}

function assertSystemWorkflowUpdateAllowed(beforeGraph: WorkflowGraph, afterGraph: WorkflowGraph): void {
  const beforeNodes = buildNodeSignatureMap(beforeGraph);
  const afterNodes = buildNodeSignatureMap(afterGraph);

  if (beforeNodes.size !== afterNodes.size) {
    throw new Error("内置工作流仅允许修改参数与位置，禁止增删节点");
  }

  for (const [nodeId, beforeNode] of beforeNodes) {
    const afterNode = afterNodes.get(nodeId);
    if (!afterNode) {
      throw new Error("内置工作流仅允许修改参数与位置，禁止增删节点");
    }
    if (beforeNode.type !== afterNode.type) {
      throw new Error("内置工作流仅允许修改参数与位置，禁止修改节点类型");
    }
    if (beforeNode.remark !== afterNode.remark) {
      throw new Error("内置工作流仅允许修改参数与位置，禁止修改节点备注");
    }
  }

  const beforeEdges = buildEdgeSignatures(beforeGraph);
  const afterEdges = buildEdgeSignatures(afterGraph);
  if (beforeEdges.length !== afterEdges.length) {
    throw new Error("内置工作流仅允许修改参数与位置，禁止增删连线");
  }
  for (let i = 0; i < beforeEdges.length; i += 1) {
    if (beforeEdges[i] !== afterEdges[i]) {
      throw new Error("内置工作流仅允许修改参数与位置，禁止修改连线结构");
    }
  }
}

interface WorkflowTaskCommandContext {
  ensureDefaultWorkflows(): void;
  workflowToMeta(workflow: WorkflowDefinition): WorkflowMeta;
  getWorkflowById(workflowId: string): WorkflowDefinition;
  findSystemWorkflowDefinition(workflowId: string): WorkflowDefinition | undefined;
  createSystemWorkflowDefinitions(): WorkflowDefinition[];
  assertWorkflowNameUnique(name: string, ignoreWorkflowId?: string): void;
  normalizeWorkflowName(name: string): string;
  createEmptyGraph(): WorkflowGraph;
  createRunDir(workflowName: string): string;
  toIsoNow(): string;
  ensureDir(dirPath: string): Promise<void>;
  getWorkflowsFromStore(): WorkflowDefinition[];
  setWorkflowsToStore(workflows: WorkflowDefinition[]): void;
  getTasksFromStore(): WorkflowTaskRecord[];
  setTasksToStore(tasks: WorkflowTaskRecord[]): void;
  writeTaskRuntime(taskId: string, runtime: TaskRuntimeSnapshot): Promise<void>;
  readTaskRuntime(taskId: string): Promise<TaskRuntimeSnapshot>;
  deleteTaskRuntime(taskId: string): Promise<void>;
  tryFindTask(taskId: string): WorkflowTaskRecord | null;
  findTask(taskId: string): WorkflowTaskRecord;
  removeTaskFromStore(taskId: string): WorkflowTaskRecord | null;
  waitTaskLogQueue(taskId: string): Promise<void>;
  updateTask(taskId: string, patch: Partial<WorkflowTaskRecord>): WorkflowTaskRecord;
  appendTaskLog(
    taskId: string,
    message: string,
    level?: "info" | "error" | "warn",
    meta?: { nodeId?: string; nodeLabel?: string },
  ): Promise<void>;
  getSettingsFromStore(): AppSettings;
  updateSettingsInStore(patch: Partial<AppSettings>): AppSettings;
  getLicenseRecordFromStore(): LicenseStoreRecord;
  setLicenseRecordToStore(record: LicenseStoreRecord): LicenseStoreRecord;
  clearLicenseRecordInStore(): LicenseStoreRecord;
  getLicenseKeysFromStore(): LicenseKeyProfile[];
  setLicenseKeysToStore(keys: LicenseKeyProfile[]): LicenseKeyProfile[];
  getActiveLicenseCodeFromStore(): string;
  setActiveLicenseCodeToStore(code: string): string;
  emitTaskBroadcast(event: string, payload: unknown): void;
  executeTask(taskId: string, resumePayload?: Record<string, unknown>): Promise<void>;
  removedTaskIds: Set<string>;
  taskLogQueues: Map<string, Promise<void>>;
}

export async function invokeWorkflowTaskCommand(
  command: string,
  args: Record<string, unknown>,
  ctx: WorkflowTaskCommandContext,
): Promise<unknown> {
  ctx.ensureDefaultWorkflows();

  function buildKeyProfileFromRecord(record: LicenseStoreRecord): LicenseKeyProfile | null {
    const code = normalizeActivationCode(record.activationCode);
    if (!code) {
      return null;
    }
    return {
      activationCode: code,
      unlockPayload: record.unlockPayload,
      lastVerifiedAt: record.lastVerifiedAt,
      cachedUntil: record.cachedUntil,
      status: "valid",
    };
  }

  function ensureLicenseKeyStoreConsistency(): { keys: LicenseKeyProfile[]; activeCode: string } {
    let keys = ctx.getLicenseKeysFromStore();
    let activeCode = normalizeActivationCode(ctx.getActiveLicenseCodeFromStore());
    const record = ctx.getLicenseRecordFromStore();
    const profile = buildKeyProfileFromRecord(record);
    let changed = false;

    if (profile && !keys.some((item) => normalizeActivationCode(item.activationCode) === profile.activationCode)) {
      keys = [...keys, profile];
      changed = true;
    }

    if (!activeCode && profile?.activationCode) {
      activeCode = profile.activationCode;
      changed = true;
    }

    if (activeCode && !keys.some((item) => normalizeActivationCode(item.activationCode) === activeCode)) {
      activeCode = "";
      changed = true;
    }

    if (changed) {
      keys = ctx.setLicenseKeysToStore(keys);
      activeCode = ctx.setActiveLicenseCodeToStore(activeCode);
    }

    return { keys, activeCode };
  }

  function upsertLicenseKeyProfile(profile: LicenseKeyProfile): LicenseKeyProfile[] {
    const normalizedCode = normalizeActivationCode(profile.activationCode);
    const keys = ctx.getLicenseKeysFromStore();
    let found = false;
    const next = keys.map((item) => {
      if (normalizeActivationCode(item.activationCode) !== normalizedCode) {
        return item;
      }
      found = true;
      return {
        ...item,
        ...profile,
        activationCode: normalizedCode,
      };
    });
    if (!found) {
      next.push({
        ...profile,
        activationCode: normalizedCode,
      });
    }
    return ctx.setLicenseKeysToStore(next);
  }

  function updateLicenseKeyStatus(code: string, status: "valid" | "invalid"): LicenseKeyProfile[] {
    const normalizedCode = normalizeActivationCode(code);
    const keys = ctx.getLicenseKeysFromStore();
    let found = false;
    const next = keys.map((item) => {
      if (normalizeActivationCode(item.activationCode) !== normalizedCode) {
        return item;
      }
      found = true;
      return {
        ...item,
        status,
      };
    });
    if (!found && normalizedCode) {
      next.push({
        activationCode: normalizedCode,
        unlockPayload: null,
        lastVerifiedAt: "",
        cachedUntil: "",
        status,
      });
    }
    return ctx.setLicenseKeysToStore(next);
  }

  function getLicenseKeysResult(): LicenseKeysResult {
    const { keys, activeCode } = ensureLicenseKeyStoreConsistency();
    return {
      activeCode,
      keys,
      state: getCurrentLicenseState(),
    };
  }

  function getCurrentLicenseState(): LicenseState {
    ensureLicenseKeyStoreConsistency();
    return buildLicenseState(ctx.getLicenseRecordFromStore(), ctx.getWorkflowsFromStore());
  }

  function resolveAllowedNodeTypeSet(state: LicenseState): Set<string> | null {
    if (state.effectiveAllowedNodeTypes === null) {
      return null;
    }
    return new Set(state.effectiveAllowedNodeTypes);
  }

  function assertActivated(): LicenseState {
    const state = getCurrentLicenseState();
    if (!state.activated) {
      throw new Error("未检测到有效激活，请先输入激活码");
    }
    return state;
  }

  function assertGraphAllowed(graph: WorkflowGraph, allowedNodeTypeSet: Set<string> | null): WorkflowGraph {
    const normalized = normalizeWorkflowGraph(graph);
    if (!isGraphAllowedByNodeTypeSet(normalized, allowedNodeTypeSet)) {
      throw new Error("当前激活码不支持该工作流所需节点");
    }
    return normalized;
  }

  function assertWorkflowAllowed(workflow: WorkflowDefinition, allowedNodeTypeSet: Set<string> | null): WorkflowDefinition {
    assertGraphAllowed(workflow.graph, allowedNodeTypeSet);
    return workflow;
  }

  function resolveTaskGraph(task: WorkflowTaskRecord): WorkflowGraph | null {
    if (task.workflowSnapshot) {
      return normalizeWorkflowGraph(task.workflowSnapshot.graph);
    }
    try {
      const workflow = ctx.getWorkflowById(task.workflowId);
      return normalizeWorkflowGraph(workflow.graph);
    } catch {
      return null;
    }
  }

  function assertTaskAllowed(task: WorkflowTaskRecord, allowedNodeTypeSet: Set<string> | null): void {
    const graph = resolveTaskGraph(task);
    if (!graph || !isGraphAllowedByNodeTypeSet(graph, allowedNodeTypeSet)) {
      throw new Error("当前激活码不支持访问该任务");
    }
  }

  function activateAndPersist(code: string): LicenseActivationResult {
    const normalizedCode = normalizeActivationCode(code);
    const unlockPayload = resolveUnlockPayloadByActivationCode(normalizedCode);
    if (!unlockPayload) {
      updateLicenseKeyStatus(normalizedCode, "invalid");
      throw new Error("激活码无效，请检查后重试");
    }

    const nextRecord = createActivatedLicenseRecord(normalizedCode, unlockPayload);
    const savedRecord = ctx.setLicenseRecordToStore(nextRecord);
    const profile = buildKeyProfileFromRecord(savedRecord);
    if (profile) {
      upsertLicenseKeyProfile(profile);
    }
    ctx.setActiveLicenseCodeToStore(savedRecord.activationCode);

    return {
      success: true,
      message: "激活成功",
      state: getCurrentLicenseState(),
    };
  }

  switch (command) {
    case "license:get-state": {
      return getCurrentLicenseState();
    }

    case "license:list-keys": {
      return getLicenseKeysResult();
    }

    case "license:activate": {
      const code = asString(args.code).trim();
      if (!code) {
        throw new Error("激活码不能为空");
      }
      return activateAndPersist(code);
    }

    case "license:add-key": {
      const code = normalizeActivationCode(asString(args.code));
      if (!code) {
        throw new Error("激活码不能为空");
      }
      const unlockPayload = resolveUnlockPayloadByActivationCode(code);
      if (!unlockPayload) {
        updateLicenseKeyStatus(code, "invalid");
        throw new Error("激活码无效，无法添加");
      }
      const record = createActivatedLicenseRecord(code, unlockPayload);
      const profile = buildKeyProfileFromRecord(record);
      if (profile) {
        upsertLicenseKeyProfile(profile);
      }

      const activeCode = normalizeActivationCode(ctx.getActiveLicenseCodeFromStore());
      if (!activeCode) {
        ctx.setLicenseRecordToStore(record);
        ctx.setActiveLicenseCodeToStore(code);
      }

      return getLicenseKeysResult();
    }

    case "license:switch-key": {
      const code = normalizeActivationCode(asString(args.code));
      if (!code) {
        throw new Error("请选择要切换的激活码");
      }
      const unlockPayload = resolveUnlockPayloadByActivationCode(code);
      if (!unlockPayload) {
        updateLicenseKeyStatus(code, "invalid");
        throw new Error("目标激活码无效，无法切换");
      }
      const record = createActivatedLicenseRecord(code, unlockPayload);
      const savedRecord = ctx.setLicenseRecordToStore(record);
      const profile = buildKeyProfileFromRecord(savedRecord);
      if (profile) {
        upsertLicenseKeyProfile(profile);
      }
      ctx.setActiveLicenseCodeToStore(savedRecord.activationCode);
      return getLicenseKeysResult();
    }

    case "license:remove-key": {
      const code = normalizeActivationCode(asString(args.code));
      if (!code) {
        throw new Error("请选择要删除的激活码");
      }

      const currentActiveCode = normalizeActivationCode(ctx.getActiveLicenseCodeFromStore());
      const keys = ctx.getLicenseKeysFromStore();
      const remaining = keys.filter((item) => normalizeActivationCode(item.activationCode) !== code);

      if (currentActiveCode === code) {
        let switched = false;
        for (const candidate of remaining) {
          const candidateCode = normalizeActivationCode(candidate.activationCode);
          const unlockPayload = resolveUnlockPayloadByActivationCode(candidateCode);
          if (!unlockPayload) {
            continue;
          }
          const fallbackRecord = createActivatedLicenseRecord(candidateCode, unlockPayload);
          const savedFallback = ctx.setLicenseRecordToStore(fallbackRecord);
          const profile = buildKeyProfileFromRecord(savedFallback);
          if (profile) {
            upsertLicenseKeyProfile(profile);
          }
          ctx.setActiveLicenseCodeToStore(savedFallback.activationCode);
          switched = true;
          break;
        }

        if (!switched) {
          ctx.clearLicenseRecordInStore();
          ctx.setActiveLicenseCodeToStore("");
        }
      }

      ctx.setLicenseKeysToStore(remaining);

      return getLicenseKeysResult();
    }

    case "license:background-validate": {
      const current = getCurrentLicenseState();
      if (!current.activated) {
        const result: LicenseBackgroundValidateResult = {
          valid: false,
          message: "尚未激活",
          state: current,
        };
        return result;
      }

      if (current.cacheValid) {
        const result: LicenseBackgroundValidateResult = {
          valid: true,
          message: "缓存有效，无需复验",
          state: current,
        };
        return result;
      }

      const record = ctx.getLicenseRecordFromStore();
      const currentCode = normalizeActivationCode(record.activationCode);
      const unlockPayload = resolveUnlockPayloadByActivationCode(currentCode);
      if (!unlockPayload) {
        updateLicenseKeyStatus(currentCode, "invalid");
        ctx.clearLicenseRecordInStore();
        ctx.setActiveLicenseCodeToStore("");
        const failedState = getCurrentLicenseState();
        const result: LicenseBackgroundValidateResult = {
          valid: false,
          message: "激活码复验失败，请重新激活",
          state: failedState,
        };
        return result;
      }

      const refreshedRecord = createActivatedLicenseRecord(currentCode, unlockPayload);
      const savedRefreshed = ctx.setLicenseRecordToStore(refreshedRecord);
      const refreshedProfile = buildKeyProfileFromRecord(savedRefreshed);
      if (refreshedProfile) {
        upsertLicenseKeyProfile(refreshedProfile);
      }
      updateLicenseKeyStatus(currentCode, "valid");
      ctx.setActiveLicenseCodeToStore(savedRefreshed.activationCode);
      const refreshedState = getCurrentLicenseState();
      const result: LicenseBackgroundValidateResult = {
        valid: true,
        message: "激活码复验通过",
        state: refreshedState,
      };
      return result;
    }

    case "settings:get": {
      assertActivated();
      return ctx.getSettingsFromStore();
    }

    case "settings:update": {
      assertActivated();
      const payload = asRecord(args.settings ?? args);
      const patch: Partial<AppSettings> = {};
      if ("tempRootDir" in payload) {
        patch.tempRootDir = asString(payload.tempRootDir);
      }
      return ctx.updateSettingsInStore(patch);
    }

    case "workflow:list": {
      const state = assertActivated();
      const allowedNodeTypeSet = resolveAllowedNodeTypeSet(state);
      return ctx
        .getWorkflowsFromStore()
        .filter((workflow) => isGraphAllowedByNodeTypeSet(normalizeWorkflowGraph(workflow.graph), allowedNodeTypeSet))
        .map(ctx.workflowToMeta)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }

    case "workflow:get": {
      const state = assertActivated();
      const allowedNodeTypeSet = resolveAllowedNodeTypeSet(state);
      const workflowId = asString(args.id);
      const workflow = ctx.getWorkflowById(workflowId);
      assertWorkflowAllowed(workflow, allowedNodeTypeSet);
      return {
        ...workflow,
        graph: normalizeWorkflowGraph(workflow.graph),
      };
    }

    case "workflow:validate": {
      const state = assertActivated();
      const allowedNodeTypeSet = resolveAllowedNodeTypeSet(state);
      const graph = assertGraphAllowed(normalizeWorkflowGraph(args.graph), allowedNodeTypeSet);
      const issues = validateWorkflowGraphStructure(graph);
      return {
        valid: issues.length === 0,
        issues,
      };
    }

    case "workflow:create": {
      const state = assertActivated();
      const allowedNodeTypeSet = resolveAllowedNodeTypeSet(state);
      const name = asString(args.name).trim();
      if (!name) {
        throw new Error("工作流名称不能为空");
      }
      ctx.assertWorkflowNameUnique(name);

      const now = ctx.toIsoNow();
      const created: WorkflowDefinition = {
        id: crypto.randomUUID(),
        name,
        description: asString(args.description),
        source: "user",
        readonly: false,
        schemaVersion: WORKFLOW_SCHEMA_VERSION,
        systemKind: "custom",
        graph: assertGraphAllowed(normalizeWorkflowGraph(args.graph) || ctx.createEmptyGraph(), allowedNodeTypeSet),
        createdAt: now,
        updatedAt: now,
      };
      const workflows = ctx.getWorkflowsFromStore();
      workflows.push(created);
      ctx.setWorkflowsToStore(workflows);
      return created;
    }

    case "workflow:update": {
      const state = assertActivated();
      const allowedNodeTypeSet = resolveAllowedNodeTypeSet(state);
      const workflowId = asString(args.id);
      const workflows = ctx.getWorkflowsFromStore();
      const index = workflows.findIndex((item) => item.id === workflowId);
      if (index < 0) {
        throw new Error("工作流不存在");
      }
      const target = workflows[index] as WorkflowDefinition;
      assertWorkflowAllowed(target, allowedNodeTypeSet);
      const nextName = asString(args.name).trim();
      if (!nextName) {
        throw new Error("工作流名称不能为空");
      }
      const nextDescription = asString(args.description);
      if (target.source === "system") {
        if (nextName !== target.name || nextDescription !== target.description) {
          throw new Error("内置工作流仅允许修改节点参数与位置，禁止修改工作流名称或描述");
        }
      }
      ctx.assertWorkflowNameUnique(nextName, workflowId);
      const nextGraph = assertGraphAllowed(normalizeWorkflowGraph(args.graph), allowedNodeTypeSet);
      if (target.source === "system") {
        assertSystemWorkflowUpdateAllowed(normalizeWorkflowGraph(target.graph), nextGraph);
      }

      const updated: WorkflowDefinition = {
        ...target,
        name: nextName,
        description: nextDescription,
        graph: nextGraph,
        systemKind: target.source === "system" ? target.systemKind : "custom",
        updatedAt: ctx.toIsoNow(),
      };
      workflows[index] = updated;
      ctx.setWorkflowsToStore(workflows);
      return updated;
    }

    case "workflow:delete": {
      const state = assertActivated();
      const allowedNodeTypeSet = resolveAllowedNodeTypeSet(state);
      const workflowId = asString(args.id);
      const workflows = ctx.getWorkflowsFromStore();
      const target = workflows.find((item) => item.id === workflowId);
      if (!target) {
        throw new Error("工作流不存在");
      }
      assertWorkflowAllowed(target, allowedNodeTypeSet);
      if (target.source === "system") {
        throw new Error("内置工作流不可删除");
      }
      ctx.setWorkflowsToStore(workflows.filter((item) => item.id !== workflowId));
      return null;
    }

    case "workflow:restore-default": {
      const state = assertActivated();
      const allowedNodeTypeSet = resolveAllowedNodeTypeSet(state);
      const workflowId = asString(args.id);
      const defaultDefinition = ctx.findSystemWorkflowDefinition(workflowId);
      if (!defaultDefinition) {
        throw new Error("仅支持还原内置工作流");
      }
      assertWorkflowAllowed(defaultDefinition, allowedNodeTypeSet);

      const workflows = ctx.getWorkflowsFromStore();
      const index = workflows.findIndex((item) => item.id === workflowId);
      const existing = index >= 0 ? (workflows[index] as WorkflowDefinition) : null;

      const restored: WorkflowDefinition = {
        ...defaultDefinition,
        createdAt: existing?.createdAt || defaultDefinition.createdAt,
        updatedAt: ctx.toIsoNow(),
      };

      if (index >= 0) {
        workflows[index] = restored;
      } else {
        workflows.push(restored);
      }
      ctx.setWorkflowsToStore(workflows);
      return restored;
    }

    case "workflow:restore-all-default": {
      const state = assertActivated();
      const allowedNodeTypeSet = resolveAllowedNodeTypeSet(state);
      const now = ctx.toIsoNow();
      const systemDefinitions = ctx.createSystemWorkflowDefinitions();
      const workflowMap = new Map(ctx.getWorkflowsFromStore().map((item) => [item.id, item] as const));
      const restoredIds: string[] = [];

      for (const systemWorkflow of systemDefinitions) {
        if (!isGraphAllowedByNodeTypeSet(normalizeWorkflowGraph(systemWorkflow.graph), allowedNodeTypeSet)) {
          continue;
        }
        const existing = workflowMap.get(systemWorkflow.id);
        const restored: WorkflowDefinition = {
          ...systemWorkflow,
          createdAt: existing?.createdAt || systemWorkflow.createdAt,
          updatedAt: now,
        };
        workflowMap.set(systemWorkflow.id, restored);
        restoredIds.push(systemWorkflow.id);
      }

      ctx.setWorkflowsToStore(Array.from(workflowMap.values()));
      return {
        restoredIds,
        count: restoredIds.length,
      };
    }

    case "workflow:duplicate": {
      const state = assertActivated();
      const allowedNodeTypeSet = resolveAllowedNodeTypeSet(state);
      const workflowId = asString(args.id);
      const sourceWorkflow = ctx.getWorkflowById(workflowId);
      assertWorkflowAllowed(sourceWorkflow, allowedNodeTypeSet);
      let nextName = asString(args.newName).trim();
      if (!nextName) {
        nextName = `${sourceWorkflow.name} 副本`;
      }
      if (
        ctx
          .getWorkflowsFromStore()
          .some((item) => ctx.normalizeWorkflowName(item.name) === ctx.normalizeWorkflowName(nextName))
      ) {
        let seq = 2;
        let candidate = `${nextName} ${String(seq)}`;
        while (
          ctx
            .getWorkflowsFromStore()
            .some((item) => ctx.normalizeWorkflowName(item.name) === ctx.normalizeWorkflowName(candidate))
        ) {
          seq += 1;
          candidate = `${nextName} ${String(seq)}`;
        }
        nextName = candidate;
      }
      ctx.assertWorkflowNameUnique(nextName);
      const now = ctx.toIsoNow();
      const duplicated: WorkflowDefinition = {
        ...sourceWorkflow,
        id: crypto.randomUUID(),
        name: nextName,
        source: "user",
        readonly: false,
        systemKind: "custom",
        createdAt: now,
        updatedAt: now,
      };
      const workflows = ctx.getWorkflowsFromStore();
      workflows.push(duplicated);
      ctx.setWorkflowsToStore(workflows);
      return duplicated;
    }

    case "workflow:run": {
      const state = assertActivated();
      const allowedNodeTypeSet = resolveAllowedNodeTypeSet(state);
      const workflowId = asString(args.id);
      const workflow = ctx.getWorkflowById(workflowId);
      assertWorkflowAllowed(workflow, allowedNodeTypeSet);
      const runtimeInput = asRecord(args.runtimeInput);
      const graphOverride = args.graph !== undefined ? normalizeWorkflowGraph(args.graph) : null;
      const runtimeWorkflow: WorkflowDefinition = graphOverride
        ? {
            ...workflow,
            graph: graphOverride,
          }
        : {
            ...workflow,
            graph: normalizeWorkflowGraph(workflow.graph),
          };
      assertGraphAllowed(runtimeWorkflow.graph, allowedNodeTypeSet);

      const issues = validateWorkflowRunConfig(runtimeWorkflow, runtimeInput);
      if (issues.length > 0) {
        throw new Error(`运行前检查失败:\n${issues.map((item) => `- ${item}`).join("\n")}`);
      }

      const taskId = crypto.randomUUID();
      ctx.removedTaskIds.delete(taskId);
      const runDir = ctx.createRunDir(runtimeWorkflow.name);
      await ctx.ensureDir(runDir);

      const task: WorkflowTaskRecord = {
        id: taskId,
        workflowId: runtimeWorkflow.id,
        workflowName: runtimeWorkflow.name,
        status: "queued",
        currentNodeId: "queued",
        createdAt: ctx.toIsoNow(),
        updatedAt: ctx.toIsoNow(),
        runDir,
        runtimeInput,
        waitingInteraction: null,
        workflowSnapshot: {
          id: runtimeWorkflow.id,
          name: runtimeWorkflow.name,
          source: runtimeWorkflow.source,
          systemKind: runtimeWorkflow.systemKind,
          graph: runtimeWorkflow.graph,
        },
      };

      const tasks = ctx.getTasksFromStore();
      tasks.push(task);
      ctx.setTasksToStore(tasks);

      await ctx.writeTaskRuntime(taskId, {
        phase: "",
        context: {},
        logs: [],
        interaction: null,
      });
      await ctx.appendTaskLog(taskId, `任务已创建，工作流: ${runtimeWorkflow.name}`);
      ctx.emitTaskBroadcast("task:update", task);

      void ctx.executeTask(taskId);
      return task;
    }

    case "task:subscribe": {
      assertActivated();
      return null;
    }

    case "task:list": {
      const state = assertActivated();
      const allowedNodeTypeSet = resolveAllowedNodeTypeSet(state);
      return ctx
        .getTasksFromStore()
        .filter((task) => {
          const graph = resolveTaskGraph(task);
          return Boolean(graph && isGraphAllowedByNodeTypeSet(graph, allowedNodeTypeSet));
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    case "task:get": {
      const state = assertActivated();
      const allowedNodeTypeSet = resolveAllowedNodeTypeSet(state);
      const taskId = asString(args.id);
      const task = ctx.findTask(taskId);
      assertTaskAllowed(task, allowedNodeTypeSet);
      const runtime = await ctx.readTaskRuntime(taskId);
      const workflowGraph = task.workflowSnapshot ? normalizeWorkflowGraph(task.workflowSnapshot.graph) : null;
      const rawGraphState = asRecord(runtime.context.graphState);
      const pendingNodeId = asString(rawGraphState.pendingNodeId || runtime.context.pendingNodeId);
      const executedNodeIds = Array.from(new Set(asStringArray(rawGraphState.executedNodeIds)));
      return {
        task,
        logs: runtime.logs,
        interactionRequest: runtime.interaction,
        workflowGraph,
        graphProgress: {
          phase: runtime.phase,
          executedNodeIds,
          pendingNodeId,
          totalNodes: workflowGraph?.nodes.length || 0,
        },
      };
    }

    case "task:cancel": {
      const state = assertActivated();
      const allowedNodeTypeSet = resolveAllowedNodeTypeSet(state);
      const taskId = asString(args.id);
      const task = ctx.findTask(taskId);
      assertTaskAllowed(task, allowedNodeTypeSet);
      if (task.status === "completed" || task.status === "failed" || task.status === "canceled") {
        return task;
      }
      const updated = ctx.updateTask(taskId, {
        status: "canceled",
        finishedAt: ctx.toIsoNow(),
        waitingInteraction: null,
      });
      const runtime = await ctx.readTaskRuntime(taskId);
      runtime.interaction = null;
      await ctx.writeTaskRuntime(taskId, runtime);
      await ctx.appendTaskLog(taskId, "任务已取消", "warn");
      return updated;
    }

    case "task:resume": {
      const state = assertActivated();
      const allowedNodeTypeSet = resolveAllowedNodeTypeSet(state);
      const taskId = asString(args.id);
      const payload = asRecord(args.payload);
      const task = ctx.findTask(taskId);
      assertTaskAllowed(task, allowedNodeTypeSet);
      if (task.status !== "waiting_input") {
        throw new Error("任务当前不在等待人工输入状态");
      }
      ctx.updateTask(taskId, {
        status: "running",
      });
      void ctx.executeTask(taskId, payload);
      return ctx.findTask(taskId);
    }

    case "task:remove": {
      const state = assertActivated();
      const allowedNodeTypeSet = resolveAllowedNodeTypeSet(state);
      const taskId = asString(args.id);
      const existing = ctx.tryFindTask(taskId);
      if (!existing) {
        return {
          id: taskId,
          removed: false,
        };
      }
      assertTaskAllowed(existing, allowedNodeTypeSet);
      ctx.removedTaskIds.add(taskId);
      ctx.removeTaskFromStore(taskId);
      await ctx.waitTaskLogQueue(taskId);
      ctx.taskLogQueues.delete(taskId);
      await ctx.deleteTaskRuntime(taskId);
      return {
        id: taskId,
        removed: true,
      };
    }

    case "task:clear-completed": {
      const state = assertActivated();
      const allowedNodeTypeSet = resolveAllowedNodeTypeSet(state);
      const tasks = ctx.getTasksFromStore();
      const completedIds = tasks
        .filter((item) => item.status === "completed")
        .filter((item) => {
          const graph = resolveTaskGraph(item);
          return Boolean(graph && isGraphAllowedByNodeTypeSet(graph, allowedNodeTypeSet));
        })
        .map((item) => item.id);
      if (completedIds.length === 0) {
        return { count: 0, ids: [] as string[] };
      }

      const completedIdSet = new Set(completedIds);
      ctx.setTasksToStore(tasks.filter((item) => !completedIdSet.has(item.id)));

      for (const taskId of completedIds) {
        ctx.removedTaskIds.add(taskId);
        await ctx.waitTaskLogQueue(taskId);
        ctx.taskLogQueues.delete(taskId);
        await ctx.deleteTaskRuntime(taskId);
        ctx.emitTaskBroadcast("task:removed", { taskId });
      }

      return {
        count: completedIds.length,
        ids: completedIds,
      };
    }

    default:
      throw new Error(`未知命令: ${command}`);
  }
}
