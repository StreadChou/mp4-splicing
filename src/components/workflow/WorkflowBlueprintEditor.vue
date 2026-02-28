<template>
  <div class="comfy-editor" :class="{ 'canvas-only-mode': isCanvasOnly }">
    <div class="top-toolbar row items-center no-wrap q-gutter-sm">
      <q-btn flat dense icon="zoom_in" @click="zoomIn">
        <q-tooltip>放大画布</q-tooltip>
      </q-btn>
      <q-btn flat dense icon="zoom_out" @click="zoomOut">
        <q-tooltip>缩小画布</q-tooltip>
      </q-btn>
      <q-btn flat dense icon="fit_screen" @click="fitView">
        <q-tooltip>适配视图</q-tooltip>
      </q-btn>
      <q-separator vertical inset />
      <q-btn dense color="primary" icon="auto_fix_high" label="自动排布" :disable="readonly" @click="autoLayout">
        <q-tooltip>将节点按网格重新排布</q-tooltip>
      </q-btn>
      <q-btn-dropdown
        v-if="isCanvasOnly && isCompleteFeature"
        dense
        color="primary"
        icon="add_circle"
        label="新增节点"
        :disable="readonly || structureLocked"
      >
        <q-list dense style="min-width: 220px">
          <q-item v-for="tpl in nodeTemplates" :key="`quick-add-${tpl.type}`" clickable v-close-popup @click="addNode(tpl)">
            <q-item-section>{{ tpl.label }}</q-item-section>
            <q-item-section side class="text-caption text-grey-6">{{ tpl.type }}</q-item-section>
          </q-item>
        </q-list>
      </q-btn-dropdown>
      <q-btn
        v-if="isCanvasOnly && isCompleteFeature && selectedNode"
        dense
        flat
        icon="edit_note"
        label="编辑备注"
        :disable="readonly || structureLocked"
        @click="promptEditSelectedNodeRemark"
      />
      <q-btn
        v-if="isCanvasOnly && isCompleteFeature && selectedNode"
        dense
        flat
        color="negative"
        icon="delete"
        label="删除节点"
        :disable="readonly || structureLocked"
        @click="removeSelectedNode"
      />
      <q-btn
        v-if="isCanvasOnly && isCompleteFeature && selectedEdge"
        dense
        flat
        color="negative"
        icon="link_off"
        label="删除连线"
        :disable="readonly || structureLocked"
        @click="removeSelectedEdge"
      />
      <q-btn
        v-if="isCanvasOnly"
        dense
        unelevated
        color="positive"
        icon="play_arrow"
        label="运行草稿"
        @click="emitRunFromCanvas"
      />
      <q-space />
      <q-badge v-if="structureLocked" color="warning" text-color="dark">系统流程结构锁定</q-badge>
      <q-badge color="teal-1" text-color="teal-10">{{ isCanvasOnly ? "画布模式" : "完整编辑器" }}</q-badge>
    </div>

    <div class="editor-main row no-wrap">
      <aside v-if="!isCanvasOnly" class="left-panel">
        <div class="panel-title">节点库</div>
        <q-banner v-if="structureLocked" dense rounded class="bg-grey-9 text-grey-4 q-mb-sm">
          系统流程不允许增删节点与连线。
        </q-banner>
        <q-input
          v-model="nodeSearch"
          dense
          outlined
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
              icon="add_circle_outline"
              class="node-add-btn"
              :label="tpl.label"
              :disable="readonly || structureLocked"
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
          :connection-line-type="ConnectionLineType.Bezier"
          :snap-to-grid="true"
          :snap-grid="[20, 20]"
          :nodes-draggable="!readonly"
          :nodes-connectable="!readonly && !structureLocked"
          :edges-updatable="!readonly && !structureLocked"
          :elements-selectable="true"
          :fit-view-on-init="true"
          :pan-on-drag="true"
          :zoom-on-scroll="true"
          :zoom-on-pinch="true"
          :min-zoom="0.15"
          :max-zoom="2.5"
          @connect="onConnect"
          @node-click="onNodeClick"
          @node-double-click="onNodeDoubleClick"
          @edge-click="onEdgeClick"
          @pane-click="clearSelection"
        >
          <Background :pattern-color="isCanvasOnly ? '#99d7cf' : '#8cc7be'" :gap="20" />
          <MiniMap pannable zoomable />
        </VueFlow>
        <div v-if="!isCanvasOnly && (selectedNode || selectedEdge)" class="floating-inspector">
          <div class="row items-center q-mb-sm">
            <div class="panel-title no-margin">属性面板</div>
            <q-space />
            <q-btn flat dense round icon="close" @click="clearSelection" />
          </div>

          <template v-if="selectedNode">
            <div class="text-subtitle2 text-grey-9">{{ selectedNodeDisplayTitle }}</div>
            <div class="text-caption text-grey-7 q-mt-xs">类型: {{ selectedNode.data?.nodeType || "custom" }}</div>
            <q-input
              class="q-mt-sm"
              dense
              outlined
              label="备注(可选)"
              :disable="readonly || structureLocked"
              :model-value="selectedNode.data?.remark || ''"
              @update:model-value="updateSelectedNodeRemark"
            />
            <q-separator class="q-my-sm" />

            <div class="text-caption text-grey-7">节点作用</div>
            <div class="text-body2 text-grey-9 q-mt-xs">
              {{ selectedNodeMacro?.summary || "该节点用于在流程中传递或处理数据。" }}
            </div>

            <div class="text-caption text-grey-7 q-mt-md">输入端点说明</div>
            <div
              v-for="input in selectedNodeInputsDoc"
              :key="`doc-in-${input.name}`"
              class="doc-row q-mt-xs"
              :title="`${input.label} (${input.name})\n类型: ${input.typeText}\n${input.description}`"
            >
              <span class="doc-port">{{ input.label }}</span>
              <span class="doc-desc">[{{ input.typeText }}] {{ input.description }}</span>
            </div>

            <div class="text-caption text-grey-7 q-mt-md">输出端点说明</div>
            <div
              v-for="output in selectedNodeOutputsDoc"
              :key="`doc-out-${output.name}`"
              class="doc-row q-mt-xs"
              :title="`${output.label} (${output.name})\n类型: ${output.typeText}\n${output.description}`"
            >
              <span class="doc-port">{{ output.label }}</span>
              <span class="doc-desc">[{{ output.typeText }}] {{ output.description }}</span>
            </div>

            <q-banner dense rounded class="bg-teal-1 text-teal-10 q-mt-md">
              参数请直接在节点内部编辑（ComfyUI 风格）。
            </q-banner>

            <div class="row q-gutter-sm q-mt-sm">
              <q-btn color="negative" flat dense label="删除节点" :disable="readonly || structureLocked" @click="removeSelectedNode" />
            </div>
          </template>

          <template v-else-if="selectedEdge">
            <div class="text-caption text-grey-7">连线：{{ selectedEdgeDisplayTitle }}</div>
            <q-btn class="q-mt-sm" color="negative" flat dense label="删除连线" :disable="readonly || structureLocked" @click="removeSelectedEdge" />
          </template>
        </div>
      </main>
    </div>
    <q-banner v-if="errorMsg" dense rounded class="bg-negative text-white q-ma-sm">
      {{ errorMsg }}
    </q-banner>
  </div>
</template>

<script setup lang="ts">
import { computed, markRaw, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { ConnectionLineType, VueFlow, type Connection, type Edge, type Node } from "@vue-flow/core";
import { Background } from "@vue-flow/background";
import { MiniMap } from "@vue-flow/minimap";
import { open as openDialog } from "src/tauri-compat/dialog";
import {
  PORT_VALUE_TYPES,
  WORKFLOW_NODE_MACRO_MAP,
  WORKFLOW_NODE_MACROS,
  WORKFLOW_NODE_PORT_TEMPLATES,
  formatPortTypeText,
} from "src/shared/workflow-node-macros";
import type { PortDataType } from "src/shared/nodes";
import { arePortSpecsCompatible } from "src/shared/nodes";
import { getNodeDefinition } from "src/shared/nodes";
import ComfyNode from "./ComfyNode.vue";
import type { WorkflowGraph, WorkflowGraphNode } from "./types";

interface NodeTemplate {
  type: string;
  label: string;
  inputs: string[];
  outputs: string[];
}

interface PortTypeSpecView {
  valueType: PortDataType;
  multiple: boolean;
}

interface NodeData {
  remark?: string;
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
  structureLocked?: boolean;
  canvasMode?: "full" | "canvas-only";
  featureLevel?: "basic" | "complete";
}>();

const emit = defineEmits<{
  "update:modelValue": [value: WorkflowGraph];
  "run-from-canvas": [];
  "graph-dirty-change": [dirty: boolean];
}>();

const readonly = computed(() => props.readonly === true);
const structureLocked = computed(() => props.structureLocked === true);
const isCanvasOnly = computed(() => props.canvasMode === "canvas-only");
const isCompleteFeature = computed(() => (props.featureLevel || "complete") === "complete");
const nodeSearch = ref("");
const errorMsg = ref("");
const baselineGraphSnapshot = ref("");

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
const selectedNodeDisplayTitle = computed(() => {
  if (!selectedNode.value?.data) {
    return "";
  }
  return formatNodeDisplayTitle(selectedNode.value.data.remark, selectedNode.value.data.nodeTypeLabel);
});
const selectedEdgeDisplayTitle = computed(() => {
  if (!selectedEdge.value) {
    return "";
  }
  const sourceNode = flowNodes.value.find((node) => node.id === selectedEdge.value?.source);
  const targetNode = flowNodes.value.find((node) => node.id === selectedEdge.value?.target);
  const sourceTitle = sourceNode?.data
    ? formatNodeDisplayTitle(sourceNode.data.remark, sourceNode.data.nodeTypeLabel)
    : selectedEdge.value.source;
  const targetTitle = targetNode?.data
    ? formatNodeDisplayTitle(targetNode.data.remark, targetNode.data.nodeTypeLabel)
    : selectedEdge.value.target;
  return `${sourceTitle} -> ${targetTitle}`;
});

function formatNodeDisplayTitle(remark: unknown, typeLabel: string): string {
  const text = typeof remark === "string" ? remark.trim() : "";
  if (!text) {
    return typeLabel;
  }
  return `${text}(${typeLabel})`;
}

function mapPortDocs(
  ports: string[],
  nodeId: string,
  nodeType: string,
  direction: "input" | "output",
  docs: Array<{ name: string; label: string; valueType: string; multiple: boolean; typeText: string; description: string }> | undefined,
): Array<{ name: string; label: string; valueType: string; multiple: boolean; typeText: string; description: string }> {
  const docMap = new Map((docs ?? []).map((item) => [item.name, item]));
  return ports.map((name) => ({
    ...resolvePortTypeDoc(nodeId, nodeType, direction, name),
    name,
    label: docMap.get(name)?.label || resolvePortTypeDoc(nodeId, nodeType, direction, name).label,
    description: docMap.get(name)?.description || "该端口用于与其它节点连线传递数据。",
  }));
}

const selectedNodeInputsDoc = computed(() => {
  if (!selectedNode.value?.data) {
    return [];
  }
  const ports = selectedNode.value?.data?.inputs || [];
  return mapPortDocs(ports, selectedNode.value.id, selectedNode.value.data.nodeType, "input", selectedNodeMacro.value?.inputs);
});

const selectedNodeOutputsDoc = computed(() => {
  if (!selectedNode.value?.data) {
    return [];
  }
  const ports = selectedNode.value?.data?.outputs || [];
  return mapPortDocs(ports, selectedNode.value.id, selectedNode.value.data.nodeType, "output", selectedNodeMacro.value?.outputs);
});

function resolvePortTypeSpecBase(nodeType: string, direction: "input" | "output", portName: string): PortTypeSpecView {
  const macro = WORKFLOW_NODE_MACRO_MAP[nodeType];
  if (!macro) {
    return {
      valueType: PORT_VALUE_TYPES.ANY_PAYLOAD as PortDataType,
      multiple: false,
    };
  }
  const ports = direction === "input" ? macro.inputs : macro.outputs;
  const found = ports.find((port) => port.name === portName);
  return {
    valueType: (found?.valueType || PORT_VALUE_TYPES.ANY_PAYLOAD) as PortDataType,
    multiple: found?.multiple === true,
  };
}

function resolvePortLabel(nodeType: string, direction: "input" | "output", portName: string): string {
  const macro = WORKFLOW_NODE_MACRO_MAP[nodeType];
  if (!macro) {
    return portName;
  }
  const ports = direction === "input" ? macro.inputs : macro.outputs;
  return ports.find((port) => port.name === portName)?.label || portName;
}

function resolvePortTypeSpec(
  nodeId: string,
  nodeType: string,
  direction: "input" | "output",
  portName: string,
): PortTypeSpecView {
  const base = resolvePortTypeSpecBase(nodeType, direction, portName);

  const incomingEdge = flowEdges.value.find((edge) => {
    if (edge.target !== nodeId) {
      return false;
    }
    const targetPorts = WORKFLOW_NODE_PORT_TEMPLATES[nodeType]?.inputs || [];
    const resolvedTargetPort = resolveHandlePortName(edge.targetHandle, targetPorts, "in", targetPorts[0] || "input");
    if (nodeType === "iterate" && portName === "items") {
      return resolvedTargetPort === "items";
    }
    if (nodeType === "repeat" && portName === "raw") {
      return resolvedTargetPort === "raw";
    }
    return false;
  });

  if (!incomingEdge) {
    return base;
  }

  const sourceNode = flowNodes.value.find((node) => node.id === incomingEdge.source);
  if (!sourceNode?.data) {
    return base;
  }
  const sourcePorts = WORKFLOW_NODE_PORT_TEMPLATES[sourceNode.data.nodeType]?.outputs || [];
  const sourcePort = resolveHandlePortName(incomingEdge.sourceHandle, sourcePorts, "out", sourcePorts[0] || "result");
  const sourceSpec = resolvePortTypeSpecBase(sourceNode.data.nodeType, "output", sourcePort);

  if (nodeType === "iterate") {
    if (direction === "output" && portName === "item") {
      return { valueType: sourceSpec.valueType, multiple: false };
    }
    if (direction === "output" && portName === "raw") {
      return { valueType: sourceSpec.valueType, multiple: true };
    }
    if (direction === "input" && portName === "items") {
      return { valueType: sourceSpec.valueType, multiple: true };
    }
  }

  if (nodeType === "repeat" && portName === "raw") {
    return {
      valueType: sourceSpec.valueType,
      multiple: sourceSpec.multiple,
    };
  }

  return base;
}

function resolvePortTypeDoc(nodeId: string, nodeType: string, direction: "input" | "output", portName: string): {
  valueType: string;
  multiple: boolean;
  typeText: string;
  label: string;
} {
  const spec = resolvePortTypeSpec(nodeId, nodeType, direction, portName);
  return {
    label: resolvePortLabel(nodeType, direction, portName),
    valueType: spec.valueType,
    multiple: spec.multiple,
    typeText: formatPortTypeText(spec.valueType, spec.multiple),
  };
}

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

function isPortValueTypeCompatible(
  source: { valueType: PortDataType; multiple: boolean },
  target: { valueType: PortDataType; multiple: boolean },
): boolean {
  return arePortSpecsCompatible(source, target);
}

const defaultEdgeOptions = {
  type: "default",
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
  const definition = getNodeDefinition(type);
  return { ...(definition?.defaults || {}) };
}

function defaultPosition(index: number): { x: number; y: number } {
  return {
    x: 80 + (index % 3) * 420,
    y: 90 + Math.floor(index / 3) * 260,
  };
}

function normalizeTypeIdPrefix(nodeType: string): string {
  const normalized = nodeType.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized || "node";
}

function getNextNodeId(nodeType: string): string {
  const prefix = normalizeTypeIdPrefix(nodeType);
  let maxIndex = 0;
  const matcher = new RegExp(`^${prefix}_(\\d+)$`);
  for (const node of flowNodes.value) {
    const match = node.id.match(matcher);
    if (match) {
      const index = Number(match[1]);
      if (Number.isFinite(index) && index > maxIndex) {
        maxIndex = index;
      }
      continue;
    }
    if (node.id === prefix) {
      maxIndex = Math.max(maxIndex, 1);
    }
  }
  return `${prefix}_${String(maxIndex + 1)}`;
}

function canonicalizeGraphNodeIds(graph: WorkflowGraph): WorkflowGraph {
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph.edges) ? graph.edges : [];

  if (structureLocked.value) {
    const normalizedNodes = nodes.map((node, idx) => {
      const type = typeof node.type === "string" && node.type.trim() ? node.type : "custom";
      const id = typeof node.id === "string" && node.id.trim() ? node.id.trim() : `node_${String(idx + 1)}`;
      return {
        ...node,
        id,
        type,
      };
    });

    const nodeIdSet = new Set(normalizedNodes.map((node) => node.id));
    const normalizedEdges = edges
      .map((edge, idx) => {
        if (!nodeIdSet.has(edge.source) || !nodeIdSet.has(edge.target)) {
          return null;
        }
        return {
          ...edge,
          id: edge.id || `edge_${String(idx + 1)}`,
        };
      })
      .filter((edge): edge is WorkflowGraph["edges"][number] => edge !== null);

    return {
      nodes: normalizedNodes,
      edges: normalizedEdges,
    };
  }

  const counters = new Map<string, number>();
  const idMap = new Map<string, string>();

  const normalizedNodes = nodes.map((node, idx) => {
    const type = typeof node.type === "string" && node.type.trim() ? node.type : "custom";
    const prefix = normalizeTypeIdPrefix(type);
    const nextIndex = (counters.get(prefix) || 0) + 1;
    counters.set(prefix, nextIndex);

    const oldId = typeof node.id === "string" && node.id.trim() ? node.id : `node_${String(idx + 1)}`;
    const id = `${prefix}_${String(nextIndex)}`;
    idMap.set(oldId, id);

    return {
      ...node,
      id,
      type,
    };
  });

  const nodeIdSet = new Set(normalizedNodes.map((node) => node.id));
  const normalizedEdges = edges
    .map((edge, idx) => {
      const mappedSource = idMap.get(edge.source);
      const mappedTarget = idMap.get(edge.target);
      if (!mappedSource || !mappedTarget) {
        return null;
      }
      if (!nodeIdSet.has(mappedSource) || !nodeIdSet.has(mappedTarget)) {
        return null;
      }
      return {
        ...edge,
        id: edge.id || `edge_${String(idx + 1)}`,
        source: mappedSource,
        target: mappedTarget,
      };
    })
    .filter((edge): edge is WorkflowGraph["edges"][number] => edge !== null);

  return {
    nodes: normalizedNodes,
    edges: normalizedEdges,
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
  remark: string | undefined,
  nodeType: string,
  inputs: string[],
  outputs: string[],
  config: Record<string, unknown>,
): NodeData {
  return {
    remark,
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
      node.remark,
      node.type,
      [...template.inputs],
      [...template.outputs],
      (node.config ?? {}) as Record<string, unknown>,
    ),
  };
}

function toGraph(): WorkflowGraph {
  const rawGraph: WorkflowGraph = {
    nodes: flowNodes.value.map((node) => ({
      id: node.id,
      type: node.data?.nodeType || "custom",
      ...(node.data?.remark ? { remark: node.data.remark } : {}),
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
  return canonicalizeGraphNodeIds(rawGraph);
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
  emit("graph-dirty-change", snapshot !== baselineGraphSnapshot.value);
}

function clearSelection() {
  selectedNodeId.value = "";
  selectedEdgeId.value = "";
}

function syncFromModel(graph: WorkflowGraph) {
  const canonicalGraph = canonicalizeGraphNodeIds(graph);
  baselineGraphSnapshot.value = JSON.stringify(canonicalGraph);
  emit("graph-dirty-change", false);
  syncingFromProps = true;
  flowNodes.value = (canonicalGraph.nodes || []).map((node, idx) => graphNodeToFlowNode(node, idx));
  flowEdges.value = (canonicalGraph.edges || []).map((edge) => ({
    id: edge.id,
    type: "default",
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

function onNodeDoubleClick(event: { node: Node<NodeData> }) {
  if (!isCanvasOnly.value || !isCompleteFeature.value || readonly.value || structureLocked.value) {
    return;
  }
  const currentRemark = event.node.data?.remark || "";
  const nextRemark = window.prompt("输入节点备注（可留空）", currentRemark);
  if (nextRemark === null) {
    return;
  }
  updateNodeData(event.node.id, (oldData) => ({
    ...oldData,
    remark: nextRemark.trim(),
  }));
}

function onEdgeClick(event: { edge: Edge }) {
  selectedNodeId.value = "";
  selectedEdgeId.value = event.edge.id;
}

function onConnect(connection: Connection) {
  if (readonly.value || structureLocked.value || !connection.source || !connection.target) {
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
  const sourceTypeSpec = resolvePortTypeSpec(sourceNode.id, sourceNode.data.nodeType, "output", sourcePort);
  const targetTypeSpec = resolvePortTypeSpec(targetNode.id, targetNode.data.nodeType, "input", targetPort);
  if (!isPortValueTypeCompatible(sourceTypeSpec, targetTypeSpec)) {
    const sourceName = sourceNode.data.remark || sourceNode.data.nodeTypeLabel || sourceNode.id;
    const targetName = targetNode.data.remark || targetNode.data.nodeTypeLabel || targetNode.id;
    const sourceTypeText = formatPortTypeText(sourceTypeSpec.valueType, sourceTypeSpec.multiple);
    const targetTypeText = formatPortTypeText(targetTypeSpec.valueType, targetTypeSpec.multiple);
    errorMsg.value = `连线失败：${sourceName}.${sourcePort}[${sourceTypeText}] 与 ${targetName}.${targetPort}[${targetTypeText}] 类型不兼容`;
    return;
  }
  errorMsg.value = "";

  const edgeId = `edge_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  flowEdges.value = [
    ...flowEdges.value,
    {
      id: edgeId,
      type: "default",
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle,
      targetHandle: connection.targetHandle,
    },
  ];
  emitGraph();
}

function addNode(template: NodeTemplate) {
  if (readonly.value || structureLocked.value) {
    return;
  }

  const index = flowNodes.value.length;
  const nodeId = getNextNodeId(template.type);
  flowNodes.value = [
    ...flowNodes.value,
    {
      id: nodeId,
      type: "comfy",
      position: defaultPosition(index),
      data: buildNodeData(
        nodeId,
        "",
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
  if (readonly.value || structureLocked.value || !selectedNode.value) {
    return;
  }
  const targetId = selectedNode.value.id;
  flowNodes.value = flowNodes.value.filter((node) => node.id !== targetId);
  flowEdges.value = flowEdges.value.filter((edge) => edge.source !== targetId && edge.target !== targetId);
  clearSelection();
  emitGraph();
}

function removeSelectedEdge() {
  if (readonly.value || structureLocked.value || !selectedEdge.value) {
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

function updateSelectedNodeRemark(value: string | number | null) {
  if (readonly.value || structureLocked.value || !selectedNode.value) {
    return;
  }
  const remark = typeof value === "string" ? value : value == null ? "" : String(value);
  updateNodeData(selectedNode.value.id, (oldData) => ({
    ...oldData,
    remark,
  }));
}

function promptEditSelectedNodeRemark() {
  if (!selectedNode.value) {
    return;
  }
  onNodeDoubleClick({ node: selectedNode.value });
}

function emitRunFromCanvas() {
  emit("run-from-canvas");
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
    if (structureLocked.value) {
      return;
    }
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
  border: 1px solid rgba(5, 89, 83, 0.18);
  border-radius: 16px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.72);
}

.top-toolbar {
  height: 46px;
  padding: 0 10px;
  border-bottom: 1px solid rgba(5, 89, 83, 0.16);
  background: rgba(236, 251, 249, 0.9);
}

.editor-main {
  min-height: 560px;
}

.left-panel {
  width: 260px;
  padding: 10px;
  background: rgba(245, 255, 254, 0.94);
  border-right: 1px solid rgba(5, 89, 83, 0.12);
}

.panel-title {
  color: #0d4f4b;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 10px;
}

.no-margin {
  margin-bottom: 0;
}

.canvas-shell {
  flex: 1;
  min-width: 0;
  position: relative;
  background: linear-gradient(160deg, rgba(232, 247, 245, 0.86), rgba(255, 252, 247, 0.84));
}

.workflow-flow {
  width: 100%;
  height: 100%;
  min-height: 560px;
}

.node-add-btn {
  justify-content: flex-start;
  color: #0a4a45;
  background: rgba(21, 170, 152, 0.12);
}

.node-add-btn :deep(.q-btn__content) {
  justify-content: flex-start;
  width: 100%;
  gap: 6px;
}

.floating-inspector {
  position: absolute;
  top: 10px;
  right: 10px;
  left: auto;
  width: min(240px, calc(100% - 20px));
  max-width: 240px;
  max-height: 290px;
  overflow: auto;
  padding: 8px;
  border-radius: 10px;
  border: 1px solid rgba(5, 89, 83, 0.2);
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 10px 20px rgba(13, 79, 75, 0.2);
  z-index: 10;
}

.floating-inspector .panel-title {
  font-size: 12px;
}

.floating-inspector :deep(.q-btn) {
  min-height: 26px;
  font-size: 11px;
}

.floating-inspector :deep(.q-field__control) {
  min-height: 30px;
}

.floating-inspector :deep(.q-field__native),
.floating-inspector :deep(.q-field__label) {
  font-size: 11px;
}

.floating-inspector :deep(.q-banner) {
  padding: 4px 6px;
  font-size: 11px;
}

.floating-inspector :deep(.q-mb-sm) {
  margin-bottom: 6px !important;
}

.floating-inspector :deep(.q-mt-sm) {
  margin-top: 6px !important;
}

.floating-inspector :deep(.q-mt-md) {
  margin-top: 8px !important;
}

.floating-inspector :deep(.q-my-sm) {
  margin-top: 6px !important;
  margin-bottom: 6px !important;
}

.doc-row {
  display: flex;
  align-items: flex-start;
  gap: 4px;
}

.doc-port {
  min-width: 46px;
  color: #0e9488;
  font-size: 11px;
}

.doc-desc {
  color: #2f5f5c;
  font-size: 11px;
  line-height: 1.3;
}

:deep(.vue-flow__edge-path) {
  stroke: #10a195;
  stroke-width: 2px;
}

:deep(.vue-flow__node.selected) {
  box-shadow: 0 0 0 2px rgba(16, 161, 149, 0.55);
  border-radius: 12px;
}

:deep(.vue-flow__background-pattern) {
  opacity: 0.36;
}

.canvas-only-mode {
  min-height: 640px;
}

.canvas-only-mode .top-toolbar {
  background: rgba(240, 255, 252, 0.95);
}

.canvas-only-mode .workflow-flow {
  min-height: 640px;
}
</style>
