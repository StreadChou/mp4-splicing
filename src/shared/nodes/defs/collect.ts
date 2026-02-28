import { NodeType, PortDataType, PortDirection } from "../enums";
import type { NodeDefinition } from "../types";

export const COLLECT_NODE: NodeDefinition = {
  type: NodeType.COLLECT,
  name: "收集",
  summary: "收集循环产物，收到结束信号后输出汇总列表。",
  palette: true,
  ports: [
    {
      name: "items",
      direction: PortDirection.INPUT,
      valueType: PortDataType.ANY_PAYLOAD,
      multiple: true,
      required: true,
      description: "待收集的数据（可来自循环体输出）。",
    },
    {
      name: "done",
      direction: PortDirection.INPUT,
      valueType: PortDataType.COMPLETION_SIGNAL,
      required: true,
      description: "循环结束信号。",
    },
    {
      name: "items",
      direction: PortDirection.OUTPUT,
      valueType: PortDataType.ANY_PAYLOAD,
      multiple: true,
      required: true,
      description: "收集后的汇总数据。",
    },
    {
      name: "count",
      direction: PortDirection.OUTPUT,
      valueType: PortDataType.COUNT,
      required: true,
      description: "收集数据数量。",
    },
    {
      name: "result",
      direction: PortDirection.OUTPUT,
      valueType: PortDataType.RESULT_SUMMARY,
      required: true,
      description: "收集结果摘要。",
    },
  ],
  fields: [],
  defaults: {},
  runtime: {
    executor: "collect",
  },
};
