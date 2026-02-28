import { NodeFieldType, NodeType, PortDataType, PortDirection } from "../enums";
import type { NodeDefinition } from "../types";

export const COMPOSE_VIDEOS_NODE: NodeDefinition = {
  type: NodeType.COMPOSE_VIDEOS,
  name: "视频组合",
  summary: "组合视频列表，可选接入开头和结尾视频。",
  palette: true,
  ports: [
    {
      name: "files",
      direction: PortDirection.INPUT,
      valueType: PortDataType.ABSOLUTE_PATH,
      multiple: true,
      required: true,
      description: "主视频列表。",
    },
    {
      name: "startVideo",
      direction: PortDirection.INPUT,
      valueType: PortDataType.ABSOLUTE_PATH,
      required: false,
      description: "可选开头视频。",
    },
    {
      name: "endVideo",
      direction: PortDirection.INPUT,
      valueType: PortDataType.ABSOLUTE_PATH,
      required: false,
      description: "可选结尾视频。",
    },
    {
      name: "outputDir",
      direction: PortDirection.INPUT,
      valueType: PortDataType.ABSOLUTE_PATH,
      required: true,
      description: "输出目录。",
    },
    {
      name: "file",
      direction: PortDirection.OUTPUT,
      valueType: PortDataType.ABSOLUTE_PATH,
      required: true,
      description: "单个组合产物（多次时为首个）。",
    },
    {
      name: "files",
      direction: PortDirection.OUTPUT,
      valueType: PortDataType.ABSOLUTE_PATH,
      multiple: true,
      required: true,
      description: "组合产物文件。",
    },
    {
      name: "result",
      direction: PortDirection.OUTPUT,
      valueType: PortDataType.RESULT_SUMMARY,
      required: true,
      description: "组合结果摘要。",
    },
  ],
  fields: [
    {
      key: "shuffle",
      label: "随机打乱",
      type: NodeFieldType.BOOLEAN,
      required: true,
      defaultValue: false,
    },
  ],
  defaults: {
    shuffle: false,
  },
  runtime: {
    executor: "compose_videos",
  },
};
