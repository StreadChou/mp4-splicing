export type WorkflowSource = "system" | "user";

export type BuiltinWorkflowKind =
  | "batch_download"
  | "concat"
  | "auto_split"
  | "auto_split_concat"
  | "download_auto_split"
  | "remove_ending"
  | "custom";

export type WorkflowTaskStatus = "queued" | "running" | "waiting_input" | "completed" | "failed" | "canceled";

export interface WorkflowGraphNode {
  id: string;
  type: string;
  remark?: string;
  config?: Record<string, unknown>;
  position?: {
    x: number;
    y: number;
  };
}

export interface WorkflowGraphEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface WorkflowGraph {
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  source: WorkflowSource;
  readonly: boolean;
  schemaVersion: number;
  systemKind: BuiltinWorkflowKind;
  graph: WorkflowGraph;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowMeta {
  id: string;
  name: string;
  description: string;
  source: WorkflowSource;
  readonly: boolean;
  updatedAt: string;
  systemKind: BuiltinWorkflowKind;
}

export interface InteractionOption {
  label: string;
  value: string;
}

export type InteractionFieldType = "text" | "textarea" | "number" | "boolean" | "select" | "json";

export interface InteractionField {
  id: string;
  label: string;
  type: InteractionFieldType;
  required?: boolean;
  defaultValue?: unknown;
  placeholder?: string;
  helpText?: string;
  options?: InteractionOption[];
}

export interface InteractionRequest {
  taskId: string;
  nodeId: string;
  title: string;
  description: string;
  formSchema: InteractionField[];
  context: Record<string, unknown>;
}

export interface WorkflowExecutionSnapshot {
  id: string;
  name: string;
  source: WorkflowSource;
  systemKind: BuiltinWorkflowKind;
  graph: WorkflowGraph;
}

export interface WorkflowTaskRecord {
  id: string;
  workflowId: string;
  workflowName: string;
  status: WorkflowTaskStatus;
  currentNodeId: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  runDir: string;
  runtimeInput: Record<string, unknown>;
  error?: string | undefined;
  waitingInteraction?: InteractionRequest | null;
  workflowSnapshot?: WorkflowExecutionSnapshot;
}

export interface TaskLogEntry {
  timestamp: string;
  level: "info" | "error" | "warn";
  message: string;
  nodeId?: string;
  nodeLabel?: string;
}

export interface TaskGraphProgress {
  phase: string;
  executedNodeIds: string[];
  pendingNodeId: string;
  totalNodes: number;
}

export interface TaskDetail {
  task: WorkflowTaskRecord;
  logs: TaskLogEntry[];
  interactionRequest: InteractionRequest | null;
  workflowGraph: WorkflowGraph | null;
  graphProgress: TaskGraphProgress;
}

export interface TaskRuntimeSnapshot {
  phase: string;
  context: Record<string, unknown>;
  logs: TaskLogEntry[];
  interaction: InteractionRequest | null;
}

export interface WorkflowStoreSchema {
  schemaVersion: number;
  workflows: WorkflowDefinition[];
  tasks: WorkflowTaskRecord[];
}

export const WORKFLOW_SCHEMA_VERSION = 6;
