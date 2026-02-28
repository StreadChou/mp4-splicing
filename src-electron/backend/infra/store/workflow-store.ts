import Store from "electron-store";
import {
  type WorkflowDefinition,
  WORKFLOW_SCHEMA_VERSION,
  type WorkflowStoreSchema,
  type WorkflowTaskRecord,
} from "../../shared/types";

let workflowStore: Store<WorkflowStoreSchema> | null = null;

function getWorkflowStore(): Store<WorkflowStoreSchema> {
  if (!workflowStore) {
    workflowStore = new Store<WorkflowStoreSchema>({
      name: "mp4handler-workflow",
      defaults: {
        schemaVersion: WORKFLOW_SCHEMA_VERSION,
        workflows: [],
        tasks: [],
      },
    });
  }
  return workflowStore;
}

export function getWorkflowsFromStore(): WorkflowDefinition[] {
  return (getWorkflowStore().get("workflows") ?? []) as WorkflowDefinition[];
}

export function getWorkflowSchemaVersion(): number {
  return Number(getWorkflowStore().get("schemaVersion") ?? 0);
}

export function setWorkflowSchemaVersion(version: number): void {
  getWorkflowStore().set("schemaVersion", version);
}

export function setWorkflowsToStore(workflows: WorkflowDefinition[]): void {
  getWorkflowStore().set("workflows", workflows);
}

export function getTasksFromStore(): WorkflowTaskRecord[] {
  return (getWorkflowStore().get("tasks") ?? []) as WorkflowTaskRecord[];
}

export function setTasksToStore(tasks: WorkflowTaskRecord[]): void {
  getWorkflowStore().set("tasks", tasks);
}

export function resetWorkflowStore(): void {
  const store = getWorkflowStore();
  store.set("schemaVersion", WORKFLOW_SCHEMA_VERSION);
  store.set("workflows", []);
  store.set("tasks", []);
}
