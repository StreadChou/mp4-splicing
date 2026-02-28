import { NodeFieldType, NodeType, PortDataType, PortDirection } from "../enums";
import type { NodeDefinition } from "../types";

export const REPEAT_NODE: NodeDefinition = {
  type: NodeType.REPEAT,
  name: "循环",
  summary: "按指定次数循环，输出原始数据与当前索引。",
  palette: true,
  ports: [
    {
      name: "raw",
      direction: PortDirection.INPUT,
      valueType: PortDataType.ANY_PAYLOAD,
      required: false,
      description: "循环输入数据。",
    },
    {
      name: "raw",
      direction: PortDirection.OUTPUT,
      valueType: PortDataType.ANY_PAYLOAD,
      required: true,
      description: "透传原始输入数据。",
    },
    {
      name: "index",
      direction: PortDirection.OUTPUT,
      valueType: PortDataType.COUNT,
      required: true,
      description: "当前循环索引。",
    },
  ],
  fields: [
    {
      key: "concurrency",
      label: "并发数量",
      type: NodeFieldType.NUMBER,
      required: true,
      defaultValue: 1,
      min: 1,
      step: 1,
    },
    {
      key: "times",
      label: "循环次数",
      type: NodeFieldType.NUMBER,
      required: true,
      defaultValue: 1,
      min: 1,
      step: 1,
    },
  ],
  defaults: {
    concurrency: 1,
    times: 1,
  },
  runtime: {
    executor: "repeat",
  },
};
