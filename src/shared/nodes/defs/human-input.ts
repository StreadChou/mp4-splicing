import { NodeFieldType, NodeType, PortDataType, PortDirection } from "../enums";
import type { NodeDefinition } from "../types";

export const HUMAN_INPUT_NODE: NodeDefinition = {
  type: NodeType.HUMAN_INPUT,
  name: "人工输入",
  summary: "运行时暂停并等待人工补充数据。",
  palette: true,
  ports: [
    {
      name: "in",
      direction: PortDirection.INPUT,
      valueType: PortDataType.ANY_PAYLOAD,
      required: false,
      description: "上游上下文。",
    },
    {
      name: "out",
      direction: PortDirection.OUTPUT,
      valueType: PortDataType.JSON_OBJECT,
      required: true,
      description: "人工输入后的 JSON 数据。",
    },
  ],
  fields: [
    {
      key: "title",
      label: "标题",
      type: NodeFieldType.TEXT,
      required: false,
      defaultValue: "需要人工处理",
    },
    {
      key: "description",
      label: "说明",
      type: NodeFieldType.TEXTAREA,
      required: false,
      defaultValue: "请填写并继续",
    },
    {
      key: "formSchema",
      label: "表单定义JSON",
      type: NodeFieldType.JSON,
      required: false,
    },
  ],
  defaults: {
    title: "需要人工处理",
    description: "请填写并继续",
  },
  runtime: {
    executor: "human_input",
  },
};
