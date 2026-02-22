export type WorkflowSource = "system" | "user";
export type BuiltinWorkflowKind =
  | "concat"
  | "single_split"
  | "batch_split"
  | "auto_download"
  | "auto_split"
  | "remove_ending"
  | "batch_download"
  | "download_auto_split"
  | "auto_split_concat"
  | "custom";

export interface WorkflowGraphNode {
  id: string;
  type: string;
  label: string;
  inputs?: string[];
  outputs?: string[];
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

export interface WorkflowMeta {
  id: string;
  name: string;
  description: string;
  source: WorkflowSource;
  readonly: boolean;
  updatedAt: string;
  systemKind: BuiltinWorkflowKind;
}

export interface WorkflowDefinition extends WorkflowMeta {
  schemaVersion: number;
  createdAt: string;
  graph: WorkflowGraph;
}

export type WorkflowTaskStatus =
  | "queued"
  | "running"
  | "waiting_input"
  | "completed"
  | "failed"
  | "canceled";

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
  error?: string;
  waitingInteraction?: InteractionRequest | null;
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
