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

export function setWorkflowsToStore(workflows: WorkflowDefinition[]): void {
  getWorkflowStore().set("workflows", workflows);
}

export function getTasksFromStore(): WorkflowTaskRecord[] {
  return (getWorkflowStore().get("tasks") ?? []) as WorkflowTaskRecord[];
}

export function setTasksToStore(tasks: WorkflowTaskRecord[]): void {
  getWorkflowStore().set("tasks", tasks);
}

