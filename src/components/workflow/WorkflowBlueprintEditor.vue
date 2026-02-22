<template>
  <div class="comfy-editor">
    <div class="top-toolbar row items-center no-wrap q-gutter-sm">
      <q-btn flat dense icon="zoom_in" @click="zoomIn" />
      <q-btn flat dense icon="zoom_out" @click="zoomOut" />
      <q-btn flat dense icon="fit_screen" @click="fitView" />
      <q-separator vertical inset />
      <q-btn dense color="primary" icon="auto_fix_high" label="自动排布" :disable="readonly" @click="autoLayout" />
      <q-space />
      <q-badge color="grey-8">ComfyUI 风格蓝图编辑器</q-badge>
    </div>

    <div class="editor-main row no-wrap">
      <aside class="left-panel">
        <div class="panel-title">节点库</div>
        <q-input
          v-model="nodeSearch"
          dense
          outlined
          dark
          placeholder="搜索节点"
          class="q-mb-sm"
        >
          <template #prepend>
            <q-icon name="search" />
          </template>
        </q-input>

        <q-scroll-area style="height: calc(100vh - 250px)">
          <div class="column q-gutter-xs">
            <q-btn
              v-for="tpl in filteredTemplates"
              :key="tpl.type"
              dense
              unelevated
              class="node-add-btn"
              :label="tpl.label"
              :disable="readonly"
              @click="addNode(tpl)"
            />
          </div>
        </q-scroll-area>
      </aside>

      <main class="canvas-shell">
        <VueFlow
          ref="flowRef"
          v-model:nodes="flowNodes"
          v-model:edges="flowEdges"
          class="workflow-flow"
          :node-types="nodeTypes"
          :default-edge-options="defaultEdgeOptions"
          :snap-to-grid="true"
          :snap-grid="[20, 20]"
          :nodes-draggable="!readonly"
          :nodes-connectable="!readonly"
          :edges-updatable="!readonly"
          :elements-selectable="true"
          :fit-view-on-init="true"
          :pan-on-drag="true"
          :zoom-on-scroll="true"
          :zoom-on-pinch="true"
          :min-zoom="0.15"
          :max-zoom="2.5"
          @connect="onConnect"
          @node-click="onNodeClick"
          @edge-click="onEdgeClick"
          @pane-click="clearSelection"
        >
          <Background pattern-color="#374151" :gap="20" />
          <MiniMap pannable zoomable />
          <Controls position="bottom-left" />
        </VueFlow>
      </main>

      <aside class="right-panel">
        <div class="panel-title">属性面板</div>

        <template v-if="selectedNode">
          <div class="text-subtitle2 text-grey-2">{{ selectedNode.data?.label || selectedNode.id }}</div>
          <div class="text-caption text-grey-5 q-mt-xs">类型: {{ selectedNode.data?.nodeType || "custom" }}</div>
          <q-separator class="q-my-sm" />

          <div class="text-caption text-grey-4">节点作用</div>
          <div class="text-body2 text-grey-2 q-mt-xs">
            {{ selectedNodeMacro?.summary || "该节点用于在流程中传递或处理数据。" }}
          </div>

          <div class="text-caption text-grey-4 q-mt-md">输入端点说明</div>
          <div
            v-for="input in selectedNodeInputsDoc"
            :key="`doc-in-${input.name}`"
            class="doc-row q-mt-xs"
          >
            <span class="doc-port">{{ input.name }}</span>
            <span class="doc-desc">[{{ input.valueType }}] {{ input.description }}</span>
          </div>

          <div class="text-caption text-grey-4 q-mt-md">输出端点说明</div>
          <div
            v-for="output in selectedNodeOutputsDoc"
            :key="`doc-out-${output.name}`"
            class="doc-row q-mt-xs"
          >
            <span class="doc-port">{{ output.name }}</span>
            <span class="doc-desc">[{{ output.valueType }}] {{ output.description }}</span>
          </div>

          <q-banner dense rounded class="bg-grey-9 text-grey-4 q-mt-md">
            参数请直接在节点内部编辑（ComfyUI 风格）。
          </q-banner>

          <div class="row q-gutter-sm q-mt-sm">
            <q-btn color="negative" flat dense label="删除节点" :disable="readonly" @click="removeSelectedNode" />
          </div>
        </template>

        <template v-else-if="selectedEdge">
          <div class="text-caption text-grey-5">连线：{{ selectedEdge.source }} -> {{ selectedEdge.target }}</div>
          <q-btn class="q-mt-sm" color="negative" flat dense label="删除连线" :disable="readonly" @click="removeSelectedEdge" />
        </template>

        <template v-else>
          <div class="text-caption text-grey-5">点击节点或连线后可编辑</div>
        </template>

        <q-banner v-if="errorMsg" dense rounded class="bg-negative text-white q-mt-sm">
          {{ errorMsg }}
        </q-banner>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, markRaw, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { VueFlow, type Connection, type Edge, type Node } from "@vue-flow/core";
import { Background } from "@vue-flow/background";
import { Controls } from "@vue-flow/controls";
import { MiniMap } from "@vue-flow/minimap";
import { open as openDialog } from "src/tauri-compat/dialog";
import {
  PORT_VALUE_TYPES,
  WORKFLOW_NODE_MACRO_MAP,
  WORKFLOW_NODE_MACROS,
} from "src/shared/workflow-node-macros";
import ComfyNode from "./ComfyNode.vue";
import type { WorkflowGraph, WorkflowGraphNode } from "./types";

interface NodeTemplate {
  type: string;
  label: string;
  inputs: string[];
  outputs: string[];
}

interface NodeData {
  label: string;
  nodeType: string;
  nodeTypeLabel: string;
  inputs: string[];
  outputs: string[];
  config: Record<string, unknown>;
  readonly: boolean;
  onConfigChange?: (key: string, value: unknown) => void;
  onPickDirectory?: (target: "inputDir" | "outputDir") => void;
  onPickVideo?: (configKey: string) => void;
}

const props = defineProps<{
  modelValue: WorkflowGraph;
  readonly?: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: WorkflowGraph];
}>();

const readonly = computed(() => props.readonly === true);
const nodeSearch = ref("");
const errorMsg = ref("");

const flowRef = ref<InstanceType<typeof VueFlow> | null>(null);
const flowNodes = ref<Array<Node<NodeData>>>([]);
const flowEdges = ref<Edge[]>([]);

const selectedNodeId = ref("");
const selectedEdgeId = ref("");

const nodeTemplates: NodeTemplate[] = WORKFLOW_NODE_MACROS.filter((macro) => macro.palette !== false).map((macro) => ({
  type: macro.type,
  label: macro.label,
  inputs: macro.inputs.map((port) => port.name),
  outputs: macro.outputs.map((port) => port.name),
}));

const nodeTypes = {
  comfy: markRaw(ComfyNode),
};

const filteredTemplates = computed(() => {
  const keyword = nodeSearch.value.trim().toLowerCase();
  if (!keyword) {
    return nodeTemplates;
  }
  return nodeTemplates.filter(
    (item) => item.label.toLowerCase().includes(keyword) || item.type.toLowerCase().includes(keyword),
  );
});

const selectedNode = computed(() => flowNodes.value.find((item) => item.id === selectedNodeId.value));
const selectedEdge = computed(() => flowEdges.value.find((item) => item.id === selectedEdgeId.value));
const selectedNodeMacro = computed(() => {
  const nodeType = selectedNode.value?.data?.nodeType || "";
  return WORKFLOW_NODE_MACRO_MAP[nodeType];
});

function mapPortDocs(
  ports: string[],
  docs: Array<{ name: string; valueType: string; description: string }> | undefined,
): Array<{ name: string; valueType: string; description: string }> {
  const docMap = new Map((docs ?? []).map((item) => [item.name, item]));
  return ports.map((name) => ({
    name,
    valueType: docMap.get(name)?.valueType || PORT_VALUE_TYPES.ANY_PAYLOAD,
    description: docMap.get(name)?.description || "该端口用于与其它节点连线传递数据。",
  }));
}

const selectedNodeInputsDoc = computed(() => {
  const ports = selectedNode.value?.data?.inputs || [];
  return mapPortDocs(ports, selectedNodeMacro.value?.inputs);
});

const selectedNodeOutputsDoc = computed(() => {
  const ports = selectedNode.value?.data?.outputs || [];
  return mapPortDocs(ports, selectedNodeMacro.value?.outputs);
});

function resolveHandlePortName(
  handleName: string | null | undefined,
  ports: string[],
  prefix: "in" | "out",
  fallback: string,
): string {
  const effectivePorts = ports.length > 0 ? ports : [fallback];
  if (!handleName) {
    return effectivePorts[0] as string;
  }
  if (effectivePorts.includes(handleName)) {
    return handleName;
  }
  const match = handleName.match(new RegExp(`^${prefix}-(\\d+)$`));
  if (match) {
    const idx = Number(match[1]);
    if (Number.isFinite(idx) && idx >= 0 && idx < effectivePorts.length) {
      return effectivePorts[idx] as string;
    }
  }
  return effectivePorts[0] as string;
}

function resolvePortValueType(nodeType: string, direction: "input" | "output", portName: string): string {
  const macro = WORKFLOW_NODE_MACRO_MAP[nodeType];
  if (!macro) {
    return PORT_VALUE_TYPES.ANY_PAYLOAD;
  }
  const ports = direction === "input" ? macro.inputs : macro.outputs;
  return ports.find((port) => port.name === portName)?.valueType || PORT_VALUE_TYPES.ANY_PAYLOAD;
}

function isPortValueTypeCompatible(sourceType: string, targetType: string): boolean {
  return (
    sourceType === targetType ||
    sourceType === PORT_VALUE_TYPES.ANY_PAYLOAD ||
    targetType === PORT_VALUE_TYPES.ANY_PAYLOAD
  );
}

const defaultEdgeOptions = {
  type: "smoothstep",
  animated: false,
  style: {
    stroke: "#f59e0b",
    strokeWidth: 2,
  },
};

let syncingFromProps = false;
let lastGraphSnapshot = "";

function getTemplateByType(type: string): NodeTemplate {
  const macro = WORKFLOW_NODE_MACRO_MAP[type];
  if (macro) {
    return {
      type: macro.type,
      label: macro.label,
      inputs: macro.inputs.map((port) => port.name),
      outputs: macro.outputs.map((port) => port.name),
    };
  }
  return nodeTemplates.find((item) => item.type === type) ?? nodeTemplates[nodeTemplates.length - 1] ?? {
    type: "custom",
    label: "自定义",
    inputs: ["in"],
    outputs: ["out"],
  };
}

function defaultConfigByNodeType(type: string): Record<string, unknown> {
  if (type === "file") {
    return {
      action: "read_mp4",
      recursive: true,
      maxDepth: 2,
    };
  }
  if (type === "video") {
    return {
      action: "split_profile",
      algorithm: "ssim",
      threshold: 0.7,
      minDuration: 2,
      skipFirst: false,
      skipLast: true,
    };
  }
  if (type === "select_video") {
    return {
      videoPath: "",
      required: false,
    };
  }
  if (type === "random_concat") {
    return {
      randomCountMin: 2,
      randomCountMax: 4,
      runTimes: 1,
    };
  }
  if (type === "remove_ending") {
    return {
      shuffleSegments: false,
    };
  }
  if (type === "network") {
    return {
      action: "batch_download",
      asyncDownload: true,
      maxConcurrent: 3,
    };
  }
  if (type === "text_split") {
    return {
      mode: "newline",
      trim: true,
      removeEmpty: true,
    };
  }
  if (type === "user_input") {
    return {
      text: "",
    };
  }
  return {};
}

function defaultPosition(index: number): { x: number; y: number } {
  return {
    x: 80 + (index % 4) * 290,
    y: 90 + Math.floor(index / 4) * 180,
  };
}

function updateNodeData(nodeId: string, updater: (data: NodeData) => NodeData) {
  flowNodes.value = flowNodes.value.map((node) => {
    if (node.id !== nodeId || !node.data) {
      return node;
    }
    return {
      ...node,
      data: updater(node.data),
    };
  });
  emitGraph();
}

function patchNodeConfig(nodeId: string, key: string, value: unknown) {
  if (readonly.value) {
    return;
  }
  updateNodeData(nodeId, (data) => {
    const nextConfig = {
      ...(data.config || {}),
    };
    const shouldDelete =
      value === undefined ||
      value === null ||
      (typeof value === "string" && value.trim().length === 0) ||
      (typeof value === "number" && !Number.isFinite(value));
    if (shouldDelete) {
      delete nextConfig[key];
    } else {
      nextConfig[key] = value;
    }
    return {
      ...data,
      config: nextConfig,
    };
  });
}

async function pickDirectoryForNode(nodeId: string, target: "inputDir" | "outputDir") {
  if (readonly.value) {
    return;
  }
  errorMsg.value = "";
  try {
    const selected = await openDialog({
      directory: true,
      title: target === "inputDir" ? "选择输入目录" : "选择输出目录",
    });
    if (typeof selected !== "string" || !selected) {
      return;
    }
    patchNodeConfig(nodeId, target, selected);
  } catch (error) {
    errorMsg.value = `选择目录失败: ${String(error)}`;
  }
}

async function pickVideoForNode(nodeId: string, configKey: string) {
  if (readonly.value) {
    return;
  }
  errorMsg.value = "";
  try {
    const selected = await openDialog({
      directory: false,
      multiple: false,
      title: "选择视频文件",
      filters: [
        {
          name: "视频文件",
          extensions: ["mp4"],
        },
      ],
    });
    if (typeof selected !== "string" || !selected) {
      return;
    }
    patchNodeConfig(nodeId, configKey, selected);
  } catch (error) {
    errorMsg.value = `选择视频失败: ${String(error)}`;
  }
}

function buildNodeData(
  nodeId: string,
  label: string,
  nodeType: string,
  inputs: string[],
  outputs: string[],
  config: Record<string, unknown>,
): NodeData {
  return {
    label,
    nodeType,
    nodeTypeLabel: getTemplateByType(nodeType).label,
    inputs,
    outputs,
    config,
    readonly: readonly.value,
    onConfigChange: (key, value) => {
      patchNodeConfig(nodeId, key, value);
    },
    onPickDirectory: (target) => {
      void pickDirectoryForNode(nodeId, target);
    },
    onPickVideo: (configKey) => {
      void pickVideoForNode(nodeId, configKey);
    },
  };
}

function graphNodeToFlowNode(node: WorkflowGraphNode, index: number): Node<NodeData> {
  const template = getTemplateByType(node.type);
  const fallback = defaultPosition(index);
  const x = Number.isFinite(node.position?.x) ? Number(node.position?.x) : fallback.x;
  const y = Number.isFinite(node.position?.y) ? Number(node.position?.y) : fallback.y;

  return {
    id: node.id,
    type: "comfy",
    position: { x, y },
    data: buildNodeData(
      node.id,
      node.label,
      node.type,
      [...template.inputs],
      [...template.outputs],
      (node.config ?? {}) as Record<string, unknown>,
    ),
  };
}

function toGraph(): WorkflowGraph {
  return {
    nodes: flowNodes.value.map((node) => ({
      id: node.id,
      type: node.data?.nodeType || "custom",
      label: node.data?.label || node.id,
      inputs: node.data?.inputs || ["in"],
      outputs: node.data?.outputs || ["out"],
      config: node.data?.config || {},
      position: {
        x: node.position.x,
        y: node.position.y,
      },
    })),
    edges: flowEdges.value.map((edge, idx) => {
      const nextEdge: WorkflowGraph["edges"][number] = {
        id: edge.id || `edge_${String(idx + 1)}`,
        source: edge.source,
        target: edge.target,
      };
      if (edge.sourceHandle) {
        nextEdge.sourceHandle = edge.sourceHandle;
      }
      if (edge.targetHandle) {
        nextEdge.targetHandle = edge.targetHandle;
      }
      return nextEdge;
    }),
  };
}

function emitGraph() {
  if (syncingFromProps) {
    return;
  }

  const graph = toGraph();
  const snapshot = JSON.stringify(graph);
  if (snapshot === lastGraphSnapshot) {
    return;
  }

  lastGraphSnapshot = snapshot;
  emit("update:modelValue", graph);
}

function clearSelection() {
  selectedNodeId.value = "";
  selectedEdgeId.value = "";
}

function syncFromModel(graph: WorkflowGraph) {
  syncingFromProps = true;
  flowNodes.value = (graph.nodes || []).map((node, idx) => graphNodeToFlowNode(node, idx));
  flowEdges.value = (graph.edges || []).map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
  }));
  clearSelection();
  void nextTick(() => {
    syncingFromProps = false;
    emitGraph();
  });
}

function onNodeClick(event: { node: Node<NodeData> }) {
  selectedEdgeId.value = "";
  selectedNodeId.value = event.node.id;
}

function onEdgeClick(event: { edge: Edge }) {
  selectedNodeId.value = "";
  selectedEdgeId.value = event.edge.id;
}

function onConnect(connection: Connection) {
  if (readonly.value || !connection.source || !connection.target) {
    return;
  }

  const sourceNode = flowNodes.value.find((node) => node.id === connection.source);
  const targetNode = flowNodes.value.find((node) => node.id === connection.target);
  if (!sourceNode?.data || !targetNode?.data) {
    errorMsg.value = "连线失败：节点不存在或节点数据异常";
    return;
  }

  const sourcePort = resolveHandlePortName(
    connection.sourceHandle,
    sourceNode.data.outputs || [],
    "out",
    sourceNode.data.outputs?.[0] || "result",
  );
  const targetPort = resolveHandlePortName(
    connection.targetHandle,
    targetNode.data.inputs || [],
    "in",
    targetNode.data.inputs?.[0] || sourcePort || "input",
  );
  const sourceValueType = resolvePortValueType(sourceNode.data.nodeType, "output", sourcePort);
  const targetValueType = resolvePortValueType(targetNode.data.nodeType, "input", targetPort);
  if (!isPortValueTypeCompatible(sourceValueType, targetValueType)) {
    errorMsg.value = `连线失败：${sourceNode.data.label}.${sourcePort}[${sourceValueType}] 与 ${targetNode.data.label}.${targetPort}[${targetValueType}] 类型不兼容`;
    return;
  }
  errorMsg.value = "";

  const edgeId = `edge_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  flowEdges.value = [
    ...flowEdges.value,
    {
      id: edgeId,
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle,
      targetHandle: connection.targetHandle,
    },
  ];
  emitGraph();
}

function addNode(template: NodeTemplate) {
  if (readonly.value) {
    return;
  }

  const index = flowNodes.value.length;
  const nodeId = `node_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  flowNodes.value = [
    ...flowNodes.value,
    {
      id: nodeId,
      type: "comfy",
      position: defaultPosition(index),
      data: buildNodeData(
        nodeId,
        `${template.label}${String(index + 1)}`,
        template.type,
        [...template.inputs],
        [...template.outputs],
        defaultConfigByNodeType(template.type),
      ),
    },
  ];
  emitGraph();
}

function removeSelectedNode() {
  if (readonly.value || !selectedNode.value) {
    return;
  }
  const targetId = selectedNode.value.id;
  flowNodes.value = flowNodes.value.filter((node) => node.id !== targetId);
  flowEdges.value = flowEdges.value.filter((edge) => edge.source !== targetId && edge.target !== targetId);
  clearSelection();
  emitGraph();
}

function removeSelectedEdge() {
  if (readonly.value || !selectedEdge.value) {
    return;
  }
  const targetId = selectedEdge.value.id;
  flowEdges.value = flowEdges.value.filter((edge) => edge.id !== targetId);
  clearSelection();
  emitGraph();
}

function autoLayout() {
  if (readonly.value) {
    return;
  }
  flowNodes.value = flowNodes.value.map((node, idx) => ({
    ...node,
    position: defaultPosition(idx),
  }));
  emitGraph();
}

function zoomIn() {
  flowRef.value?.zoomIn?.();
}

function zoomOut() {
  flowRef.value?.zoomOut?.();
}

function fitView() {
  flowRef.value?.fitView?.();
}

function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) {
    return false;
  }
  const tagName = element.tagName?.toLowerCase();
  return tagName === "input" || tagName === "textarea" || element.isContentEditable;
}

function handleEditorKeydown(event: KeyboardEvent) {
  if (readonly.value || isEditableTarget(event.target)) {
    return;
  }

  if (event.key === "Delete" || event.key === "Backspace") {
    if (selectedEdge.value) {
      removeSelectedEdge();
      event.preventDefault();
      return;
    }
    if (selectedNode.value) {
      removeSelectedNode();
      event.preventDefault();
      return;
    }
  }

  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "0") {
    fitView();
    event.preventDefault();
  }
}

watch(
  () => props.modelValue,
  (value) => {
    const normalized = value || { nodes: [], edges: [] };
    const snapshot = JSON.stringify(normalized);
    if (snapshot === lastGraphSnapshot) {
      return;
    }
    lastGraphSnapshot = snapshot;
    syncFromModel(normalized);
  },
  { immediate: true, deep: true },
);

watch(
  () => [flowNodes.value, flowEdges.value],
  () => {
    emitGraph();
  },
  { deep: true },
);

watch(
  () => readonly.value,
  (value) => {
    flowNodes.value = flowNodes.value.map((node) => {
      if (!node.data) {
        return node;
      }
      return {
        ...node,
        data: {
          ...node.data,
          readonly: value,
        },
      };
    });
  },
);

onMounted(() => {
  window.addEventListener("keydown", handleEditorKeydown);
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleEditorKeydown);
});
</script>

<style scoped>
.comfy-editor {
  min-height: 560px;
  border: 1px solid #111827;
  border-radius: 12px;
  overflow: hidden;
  background: #0b1220;
}

.top-toolbar {
  height: 46px;
  padding: 0 10px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.2);
  background: #111827;
}

.editor-main {
  min-height: 560px;
}

.left-panel,
.right-panel {
  width: 260px;
  padding: 10px;
  background: #111827;
  border-right: 1px solid rgba(148, 163, 184, 0.2);
}

.right-panel {
  width: 320px;
  border-right: none;
  border-left: 1px solid rgba(148, 163, 184, 0.2);
}

.panel-title {
  color: #f3f4f6;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 10px;
}

.canvas-shell {
  flex: 1;
  min-width: 0;
  background: #0f172a;
}

.workflow-flow {
  width: 100%;
  height: 100%;
  min-height: 560px;
}

.node-add-btn {
  justify-content: flex-start;
  color: #e5e7eb;
  background: rgba(55, 65, 81, 0.8);
}

.doc-row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}

.doc-port {
  min-width: 64px;
  color: #fbbf24;
  font-size: 12px;
}

.doc-desc {
  color: #d1d5db;
  font-size: 12px;
  line-height: 1.4;
}

:deep(.vue-flow__edge-path) {
  stroke: #f59e0b;
  stroke-width: 2px;
}

:deep(.vue-flow__node.selected) {
  box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.7);
  border-radius: 12px;
}

:deep(.vue-flow__background-pattern) {
  opacity: 0.36;
}
</style>
