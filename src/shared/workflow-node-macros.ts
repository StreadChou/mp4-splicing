import { PortDataType, PortDirection, listNodeDefinitions } from "./nodes";

/** 前端可识别的端口基础类型常量集合。 */
export const PORT_VALUE_TYPES = {
  /** 绝对路径。 */
  ABSOLUTE_PATH: PortDataType.ABSOLUTE_PATH,
  /** 纯文本。 */
  PLAIN_TEXT: PortDataType.PLAIN_TEXT,
  /** 数值计数。 */
  COUNT: PortDataType.COUNT,
  /** 完成信号。 */
  COMPLETION_SIGNAL: PortDataType.COMPLETION_SIGNAL,
  /** 结果摘要。 */
  RESULT_SUMMARY: PortDataType.RESULT_SUMMARY,
  /** 任意数据。 */
  ANY_PAYLOAD: PortDataType.ANY_PAYLOAD,
  /** JSON 对象。 */
  JSON_OBJECT: PortDataType.JSON_OBJECT,
  /** 视频拆解算法配置。 */
  VIDEO_SPLIT_ALGORITHM: PortDataType.VIDEO_SPLIT_ALGORITHM,
} as const;

/** 端口值类型联合。 */
export type PortValueType = (typeof PORT_VALUE_TYPES)[keyof typeof PORT_VALUE_TYPES];

/** 工作流端口宏定义（供前端展示/校验）。 */
export interface WorkflowNodePortMacro {
  /** 端口键名。 */
  name: string;
  /** 端口中文显示名。 */
  label: string;
  /** 端口基础类型。 */
  valueType: PortValueType;
  /** 是否数组包装。 */
  multiple: boolean;
  /** 类型展示文本（例如：纯文本[]）。 */
  typeText: string;
  /** 端口说明文案。 */
  description: string;
}

/** 工作流节点宏定义（由节点实体映射而来）。 */
export interface WorkflowNodeMacro {
  /** 节点类型。 */
  type: string;
  /** 节点显示名称。 */
  label: string;
  /** 节点摘要。 */
  summary: string;
  /** 输入端口宏。 */
  inputs: WorkflowNodePortMacro[];
  /** 输出端口宏。 */
  outputs: WorkflowNodePortMacro[];
  /** 是否显示在面板。 */
  palette?: boolean;
}

/** 端口名到中文显示名映射。 */
const PORT_LABEL_MAP: Record<string, string> = {
  items: "列表",
  item: "子项",
  raw: "原始数据",
  index: "索引",
  text: "文本",
  count: "数量",
  dir: "目录",
  inputDir: "输入目录",
  outputDir: "输出目录",
  file: "文件",
  files: "文件列表",
  startVideo: "开头视频",
  endVideo: "结尾视频",
  splitAlgorithm: "拆解算法",
  videoPath: "视频路径",
  done: "完成信号",
  doneSignal: "结束信号",
  result: "结果",
  in: "输入",
  out: "输出",
};

/** 基础类型到中文展示名映射。 */
const BASE_TYPE_TEXT: Record<PortDataType, string> = {
  [PortDataType.ABSOLUTE_PATH]: "绝对路径",
  [PortDataType.PLAIN_TEXT]: "纯文本",
  [PortDataType.COUNT]: "数值",
  [PortDataType.COMPLETION_SIGNAL]: "完成信号",
  [PortDataType.RESULT_SUMMARY]: "结果摘要",
  [PortDataType.ANY_PAYLOAD]: "任意数据",
  [PortDataType.JSON_OBJECT]: "JSON对象",
  [PortDataType.VIDEO_SPLIT_ALGORITHM]: "视频拆解算法",
};

/** 将端口类型格式化为展示文本（支持数组后缀）。 */
export function formatPortTypeText(valueType: PortDataType, multiple = false): string {
  const base = BASE_TYPE_TEXT[valueType] || "未知类型";
  return multiple ? `${base}[]` : base;
}

/** 解析端口显示名：优先使用显式 label，其次使用映射，最后回退 name。 */
function resolvePortLabel(name: string, label?: string): string {
  if (label && label.trim()) {
    return label.trim();
  }
  return PORT_LABEL_MAP[name] || name;
}

/** 将节点端口定义映射为前端宏结构。 */
function mapPortMacro(port: {
  /** 端口键名。 */
  name: string;
  /** 端口显示名（可选）。 */
  label?: string;
  /** 端口基础类型。 */
  valueType: PortDataType;
  /** 是否数组包装。 */
  multiple?: boolean;
  /** 端口说明。 */
  description: string;
}): WorkflowNodePortMacro {
  const multiple = port.multiple === true;
  return {
    name: port.name,
    label: resolvePortLabel(port.name, port.label),
    valueType: port.valueType,
    multiple,
    typeText: formatPortTypeText(port.valueType, multiple),
    description: port.description,
  };
}

/** 由节点实体定义生成前端节点宏。 */
export const WORKFLOW_NODE_MACROS: WorkflowNodeMacro[] = listNodeDefinitions().map((definition) => ({
  type: definition.type,
  label: definition.name,
  summary: definition.summary,
  inputs: definition.ports
    .filter((port) => port.direction === PortDirection.INPUT)
    .map((port) => mapPortMacro(port)),
  outputs: definition.ports
    .filter((port) => port.direction === PortDirection.OUTPUT)
    .map((port) => mapPortMacro(port)),
  palette: definition.palette,
}));

/** 节点类型到节点宏的快速索引。 */
export const WORKFLOW_NODE_MACRO_MAP: Record<string, WorkflowNodeMacro> = Object.fromEntries(
  WORKFLOW_NODE_MACROS.map((macro) => [macro.type, macro]),
) as Record<string, WorkflowNodeMacro>;

/** 节点端口模板（仅包含端口名数组，供 handle 解析使用）。 */
export const WORKFLOW_NODE_PORT_TEMPLATES: Record<string, { inputs: string[]; outputs: string[] }> = Object.fromEntries(
  WORKFLOW_NODE_MACROS.map((macro) => [
    macro.type,
    {
      inputs: macro.inputs.map((port) => port.name),
      outputs: macro.outputs.map((port) => port.name),
    },
  ]),
) as Record<string, { inputs: string[]; outputs: string[] }>;
