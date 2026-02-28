import { NodeFieldType, NodeType, PortDataType, PortDirection } from "../enums";
import type { NodeDefinition } from "../types";

export const INPUT_DIR_NODE: NodeDefinition = {
  type: NodeType.INPUT_DIR,
  name: "输入目录",
  summary: "用于设置流程输入目录。",
  palette: true,
  ports: [
    {
      name: "dir",
      direction: PortDirection.OUTPUT,
      valueType: PortDataType.ABSOLUTE_PATH,
      required: true,
      description: "输入目录绝对路径。",
    },
  ],
  fields: [
    {
      key: "inputDir",
      label: "输入目录",
      type: NodeFieldType.DIRECTORY,
      required: true,
      placeholder: "/path/to/input",
    },
  ],
  defaults: {
    inputDir: "",
  },
  runtime: {
    executor: "input_dir",
  },
};
