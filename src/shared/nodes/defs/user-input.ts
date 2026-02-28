import { NodeFieldType, NodeType, PortDataType, PortDirection } from "../enums";
import type { NodeDefinition } from "../types";

export const USER_INPUT_NODE: NodeDefinition = {
  type: NodeType.USER_INPUT,
  name: "用户输入",
  summary: "提供纯文本输入。",
  palette: true,
  ports: [
    {
      name: "text",
      direction: PortDirection.OUTPUT,
      valueType: PortDataType.PLAIN_TEXT,
      required: true,
      description: "用户输入文本。",
    },
  ],
  fields: [
    {
      key: "text",
      label: "文本输入",
      type: NodeFieldType.TEXTAREA,
      required: true,
      placeholder: "请输入任意文本",
    },
  ],
  defaults: {
    text: "",
  },
  runtime: {
    executor: "user_input",
  },
};
