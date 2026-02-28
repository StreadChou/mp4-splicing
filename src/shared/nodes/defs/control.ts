import { NodeFieldType, NodeType, PortDataType, PortDirection } from "../enums";
import type { NodeDefinition } from "../types";

export const CONTROL_NODE: NodeDefinition = {
  type: NodeType.CONTROL,
  name: "控制路由",
  summary: "执行简单路由控制和字段选择。",
  palette: true,
  ports: [
    {
      name: "in",
      direction: PortDirection.INPUT,
      valueType: PortDataType.ANY_PAYLOAD,
      required: false,
      description: "输入数据。",
    },
    {
      name: "out",
      direction: PortDirection.OUTPUT,
      valueType: PortDataType.ANY_PAYLOAD,
      required: false,
      description: "输出数据。",
    },
  ],
  fields: [
    {
      key: "action",
      label: "动作",
      type: NodeFieldType.SELECT,
      required: true,
      defaultValue: "pass",
      options: [
        { label: "透传", value: "pass" },
        { label: "按键提取", value: "pick" },
      ],
    },
    {
      key: "key",
      label: "键名",
      type: NodeFieldType.TEXT,
      required: false,
      showWhen: (config) => String(config.action || "pass") === "pick",
    },
  ],
  defaults: {
    action: "pass",
  },
  runtime: {
    executor: "control",
  },
};
