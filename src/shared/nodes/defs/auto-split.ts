import { NodeFieldType, NodeType, PortDataType, PortDirection } from "../enums";
import type { NodeDefinition } from "../types";

export const AUTO_SPLIT_NODE: NodeDefinition = {
  type: NodeType.AUTO_SPLIT,
  name: "自动拆解",
  summary: "按拆解算法拆解视频文件。",
  palette: true,
  ports: [
    {
      name: "file",
      direction: PortDirection.INPUT,
      valueType: PortDataType.ABSOLUTE_PATH,
      required: true,
      description: "待拆解视频路径。支持通过循环节点批量驱动。",
    },
    {
      name: "outputDir",
      direction: PortDirection.INPUT,
      valueType: PortDataType.ABSOLUTE_PATH,
      required: true,
      description: "拆解输出目录。",
    },
    {
      name: "splitAlgorithm",
      direction: PortDirection.INPUT,
      valueType: PortDataType.VIDEO_SPLIT_ALGORITHM,
      required: true,
      description: "拆解算法配置。",
    },
    {
      name: "files",
      direction: PortDirection.OUTPUT,
      valueType: PortDataType.ABSOLUTE_PATH,
      multiple: true,
      required: true,
      description: "拆解后输出文件。",
    },
    {
      name: "result",
      direction: PortDirection.OUTPUT,
      valueType: PortDataType.RESULT_SUMMARY,
      required: true,
      description: "拆解结果摘要。",
    },
  ],
  fields: [
    {
      key: "dropHead",
      label: "丢弃开头片段",
      type: NodeFieldType.BOOLEAN,
      required: true,
      defaultValue: false,
    },
    {
      key: "dropTail",
      label: "丢弃结尾片段",
      type: NodeFieldType.BOOLEAN,
      required: true,
      defaultValue: false,
    },
  ],
  defaults: {
    dropHead: false,
    dropTail: false,
  },
  runtime: {
    executor: "auto_split",
  },
};
