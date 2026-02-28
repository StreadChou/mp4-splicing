import { NodeType, PortDataType, PortDirection } from "../enums";
import type { NodeDefinition } from "../types";

export const DOWNLOAD_NODE: NodeDefinition = {
  type: NodeType.DOWNLOAD,
  name: "下载",
  summary: "下载单个文本项(URL)，可由循环节点批量驱动。",
  palette: true,
  ports: [
    {
      name: "item",
      direction: PortDirection.INPUT,
      valueType: PortDataType.PLAIN_TEXT,
      required: true,
      description: "待下载项(URL)。支持通过循环节点批量传入。",
    },
    {
      name: "outputDir",
      direction: PortDirection.INPUT,
      valueType: PortDataType.ABSOLUTE_PATH,
      required: true,
      description: "下载输出目录。",
    },
    {
      name: "file",
      direction: PortDirection.OUTPUT,
      valueType: PortDataType.ABSOLUTE_PATH,
      required: true,
      description: "单个下载产物路径（批量时为首个）。",
    },
    {
      name: "files",
      direction: PortDirection.OUTPUT,
      valueType: PortDataType.ABSOLUTE_PATH,
      multiple: true,
      required: true,
      description: "下载成功后的文件列表。",
    },
    {
      name: "done",
      direction: PortDirection.OUTPUT,
      valueType: PortDataType.COMPLETION_SIGNAL,
      required: true,
      description: "下载完成信号。",
    },
  ],
  fields: [],
  defaults: {},
  runtime: {
    executor: "download",
  },
};
