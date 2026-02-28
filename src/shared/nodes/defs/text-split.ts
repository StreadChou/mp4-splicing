import { NodeFieldType, NodeType, PortDataType, PortDirection } from "../enums";
import type { NodeDefinition } from "../types";

export const TEXT_SPLIT_NODE: NodeDefinition = {
  type: NodeType.TEXT_SPLIT,
  name: "文本拆分",
  summary: "将纯文本按规则拆分为文本列表。",
  palette: true,
  ports: [
    {
      name: "text",
      direction: PortDirection.INPUT,
      valueType: PortDataType.PLAIN_TEXT,
      required: true,
      description: "待拆分文本。",
    },
    {
      name: "items",
      direction: PortDirection.OUTPUT,
      valueType: PortDataType.PLAIN_TEXT,
      multiple: true,
      required: true,
      description: "拆分后的文本列表。",
    },
    {
      name: "count",
      direction: PortDirection.OUTPUT,
      valueType: PortDataType.COUNT,
      required: true,
      description: "拆分条目数。",
    },
  ],
  fields: [
    {
      key: "mode",
      label: "拆分方式",
      type: NodeFieldType.SELECT,
      required: true,
      defaultValue: "newline",
      options: [
        { label: "按换行", value: "newline" },
        { label: "按逗号", value: "comma" },
        { label: "按空白", value: "space" },
        { label: "自定义", value: "custom" },
      ],
    },
    {
      key: "customSeparator",
      label: "自定义分隔符",
      type: NodeFieldType.TEXT,
      required: false,
      placeholder: "例如: ||",
      showWhen: (config) => String(config.mode || "newline") === "custom",
    },
    {
      key: "trim",
      label: "自动 trim",
      type: NodeFieldType.BOOLEAN,
      required: false,
      defaultValue: true,
    },
    {
      key: "removeEmpty",
      label: "移除空项",
      type: NodeFieldType.BOOLEAN,
      required: false,
      defaultValue: true,
    },
  ],
  defaults: {
    mode: "newline",
    trim: true,
    removeEmpty: true,
  },
  runtime: {
    executor: "text_split",
  },
};
