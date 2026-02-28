import { NodeFieldType, NodeType, PortDataType, PortDirection } from "../enums";
import type { NodeDefinition } from "../types";

export const IO_PASS_NODE: NodeDefinition = {
  type: NodeType.IO_PASS,
  name: "IO透传",
  summary: "透传或提取字段，作为轻量适配节点。",
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
      key: "pickKey",
      label: "提取键",
      type: NodeFieldType.TEXT,
      required: false,
      placeholder: "例如 files",
    },
  ],
  defaults: {},
  runtime: {
    executor: "io_pass",
  },
};
