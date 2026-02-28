import { NodeFieldType, NodeType, PortDataType, PortDirection } from "../enums";
import type { NodeDefinition } from "../types";

export const ITERATE_NODE: NodeDefinition = {
  type: NodeType.ITERATE,
  name: "遍历",
  summary: "遍历数组输入，输出当前项/原始数据/索引。",
  palette: true,
  ports: [
    {
      name: "items",
      direction: PortDirection.INPUT,
      valueType: PortDataType.ANY_PAYLOAD,
      multiple: true,
      required: true,
      description: "待遍历数组。",
    },
    {
      name: "item",
      direction: PortDirection.OUTPUT,
      valueType: PortDataType.ANY_PAYLOAD,
      required: true,
      description: "遍历子项。",
    },
    {
      name: "raw",
      direction: PortDirection.OUTPUT,
      valueType: PortDataType.ANY_PAYLOAD,
      multiple: true,
      required: true,
      description: "原始输入数据。",
    },
    {
      name: "index",
      direction: PortDirection.OUTPUT,
      valueType: PortDataType.COUNT,
      required: true,
      description: "当前遍历索引。",
    },
    {
      name: "done",
      direction: PortDirection.OUTPUT,
      valueType: PortDataType.COMPLETION_SIGNAL,
      required: true,
      description: "遍历结束信号。",
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
  ],
  defaults: {
    concurrency: 1,
  },
  runtime: {
    executor: "iterate",
  },
};
