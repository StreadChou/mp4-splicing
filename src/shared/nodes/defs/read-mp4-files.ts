import { NodeFieldType, NodeType, PortDataType, PortDirection } from "../enums";
import type { NodeDefinition } from "../types";

export const READ_MP4_FILES_NODE: NodeDefinition = {
  type: NodeType.READ_MP4_FILES,
  name: "读取MP4",
  summary: "扫描目录中的 MP4 文件。",
  palette: true,
  ports: [
    {
      name: "dir",
      direction: PortDirection.INPUT,
      valueType: PortDataType.ABSOLUTE_PATH,
      required: true,
      description: "输入目录。",
    },
    {
      name: "files",
      direction: PortDirection.OUTPUT,
      valueType: PortDataType.ABSOLUTE_PATH,
      multiple: true,
      required: true,
      description: "扫描结果文件列表。",
    },
    {
      name: "count",
      direction: PortDirection.OUTPUT,
      valueType: PortDataType.COUNT,
      required: true,
      description: "文件数量。",
    },
  ],
  fields: [
    {
      key: "recursive",
      label: "递归读取",
      type: NodeFieldType.BOOLEAN,
      required: false,
      defaultValue: true,
    },
    {
      key: "maxDepth",
      label: "递归层数",
      type: NodeFieldType.NUMBER,
      required: false,
      defaultValue: 2,
      min: 0,
      step: 1,
    },
  ],
  defaults: {
    recursive: true,
    maxDepth: 2,
  },
  runtime: {
    executor: "read_mp4_files",
  },
};
