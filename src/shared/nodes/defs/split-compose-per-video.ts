import { NodeFieldType, NodeType, PortDataType, PortDirection } from "../enums";
import type { NodeDefinition } from "../types";

export const SPLIT_COMPOSE_PER_VIDEO_NODE: NodeDefinition = {
  type: NodeType.SPLIT_COMPOSE_PER_VIDEO,
  name: "单视频拆解并组合",
  summary: "针对单个视频执行拆解后重组，可用于去结尾并替换新结尾。",
  palette: true,
  ports: [
    {
      name: "file",
      direction: PortDirection.INPUT,
      valueType: PortDataType.ABSOLUTE_PATH,
      required: true,
      description: "单个待处理视频路径（由循环节点逐个传入）。",
    },
    {
      name: "splitOutputDir",
      direction: PortDirection.INPUT,
      valueType: PortDataType.ABSOLUTE_PATH,
      required: true,
      description: "拆解片段输出根目录。",
    },
    {
      name: "outputDir",
      direction: PortDirection.INPUT,
      valueType: PortDataType.ABSOLUTE_PATH,
      required: true,
      description: "重组视频输出根目录。",
    },
    {
      name: "splitAlgorithm",
      direction: PortDirection.INPUT,
      valueType: PortDataType.VIDEO_SPLIT_ALGORITHM,
      required: true,
      description: "视频拆解算法配置。",
    },
    {
      name: "endVideo",
      direction: PortDirection.INPUT,
      valueType: PortDataType.ABSOLUTE_PATH,
      required: false,
      description: "可选替换结尾视频。",
    },
    {
      name: "file",
      direction: PortDirection.OUTPUT,
      valueType: PortDataType.ABSOLUTE_PATH,
      required: true,
      description: "单个处理结果视频（首个）。",
    },
    {
      name: "files",
      direction: PortDirection.OUTPUT,
      valueType: PortDataType.ABSOLUTE_PATH,
      multiple: true,
      required: true,
      description: "处理结果视频列表。",
    },
    {
      name: "result",
      direction: PortDirection.OUTPUT,
      valueType: PortDataType.RESULT_SUMMARY,
      required: true,
      description: "处理结果摘要。",
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
      defaultValue: true,
    },
    {
      key: "shuffle",
      label: "重组前打乱片段",
      type: NodeFieldType.BOOLEAN,
      required: true,
      defaultValue: true,
    },
  ],
  defaults: {
    dropHead: false,
    dropTail: true,
    shuffle: true,
  },
  runtime: {
    executor: "split_compose_per_video",
  },
};
