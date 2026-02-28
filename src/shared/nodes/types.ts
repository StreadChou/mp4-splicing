import type { NodeFieldType, NodeType, PortDataType, PortDirection } from "./enums";

/** 节点端口定义。 */
export interface NodePortDefinition {
  /** 端口键名（连线与执行使用）。 */
  name: string;
  /** 端口显示名（可选，前端用于中文显示）。 */
  label?: string;
  /** 端口方向：输入/输出。 */
  direction: PortDirection;
  /** 端口基础类型。 */
  valueType: PortDataType;
  /** 是否必填（输入端口场景）。 */
  required: boolean;
  /** 是否数组包装类型。 */
  multiple?: boolean;
  /** 端口说明（用于 tooltip 和文档说明）。 */
  description: string;
}

/** 下拉项定义。 */
export interface NodeFieldOption {
  /** 选项显示文案。 */
  label: string;
  /** 选项实际值。 */
  value: string;
}

/** 节点配置字段定义。 */
export interface NodeFieldDefinition {
  /** 字段键名（写入 node.config 的 key）。 */
  key: string;
  /** 字段显示标签。 */
  label: string;
  /** 字段输入控件类型。 */
  type: NodeFieldType;
  /** 是否必填。 */
  required: boolean;
  /** 默认值。 */
  defaultValue?: unknown;
  /** 占位提示。 */
  placeholder?: string;
  /** 帮助文案。 */
  helpText?: string;
  /** 下拉选项（select 类型使用）。 */
  options?: NodeFieldOption[];
  /** 最小值（number 类型使用）。 */
  min?: number;
  /** 最大值（number 类型使用）。 */
  max?: number;
  /** 步进值（number 类型使用）。 */
  step?: number;
  /** 条件显示函数（基于当前 config）。 */
  showWhen?: (config: Record<string, unknown>) => boolean;
}

/** 节点运行时定义。 */
export interface NodeRuntimeDefinition {
  /** 执行器标识（后端注册器使用）。 */
  executor: string;
}

/** 节点实体定义。 */
export interface NodeDefinition {
  /** 节点类型。 */
  type: NodeType;
  /** 节点名称（前端展示）。 */
  name: string;
  /** 节点摘要说明。 */
  summary: string;
  /** 是否在节点面板展示。 */
  palette: boolean;
  /** 端口定义列表。 */
  ports: NodePortDefinition[];
  /** 配置字段定义列表。 */
  fields: NodeFieldDefinition[];
  /** 默认配置对象。 */
  defaults: Record<string, unknown>;
  /** 运行时执行器定义。 */
  runtime: NodeRuntimeDefinition;
}
