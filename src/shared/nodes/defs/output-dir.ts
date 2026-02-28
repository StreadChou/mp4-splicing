import { NodeFieldType, NodeType, PortDataType, PortDirection } from "../enums";
import type { NodeDefinition } from "../types";

export const OUTPUT_DIR_NODE: NodeDefinition = {
  type: NodeType.OUTPUT_DIR,
  name: "输出目录",
  summary: "用于设置流程输出目录。",
  palette: true,
  ports: [
    {
      name: "outputDir",
      direction: PortDirection.OUTPUT,
      valueType: PortDataType.ABSOLUTE_PATH,
      required: true,
      description: "输出目录绝对路径。",
    },
  ],
  fields: [
    {
      key: "outputDir",
      label: "输出目录",
      type: NodeFieldType.DIRECTORY,
      required: true,
      placeholder: "/path/to/output",
    },
  ],
  defaults: {
    outputDir: "",
  },
  runtime: {
    executor: "output_dir",
  },
};
