export const PORT_VALUE_TYPES = {
  ABSOLUTE_PATH: "AbsolutePath",
  ABSOLUTE_PATH_LIST: "AbsolutePathList",
  URL_TEXT_BLOCK: "UrlTextBlock",
  URL_LIST: "UrlList",
  COUNT: "Count",
  COMPLETION_SIGNAL: "CompletionSignal",
  RESULT_SUMMARY: "ResultSummary",
  ANY_PAYLOAD: "AnyPayload",
  JSON_OBJECT: "JsonObject",
} as const;

export type PortValueType = (typeof PORT_VALUE_TYPES)[keyof typeof PORT_VALUE_TYPES];

export interface WorkflowNodePortMacro {
  name: string;
  valueType: PortValueType;
  description: string;
}

export interface WorkflowNodeMacro {
  type: string;
  label: string;
  summary: string;
  inputs: WorkflowNodePortMacro[];
  outputs: WorkflowNodePortMacro[];
  palette?: boolean;
}

export const WORKFLOW_NODE_MACROS: WorkflowNodeMacro[] = [
  {
    type: "input_dir",
    label: "输入目录",
    summary: "用于让用户选择输入目录，常作为读取目录的来源。",
    inputs: [],
    outputs: [
      {
        name: "dir",
        valueType: PORT_VALUE_TYPES.ABSOLUTE_PATH,
        description: "用户选择后的输入目录绝对路径。",
      },
    ],
  },
  {
    type: "output_dir",
    label: "输出目录",
    summary: "用于让用户选择输出目录，后续节点会把产物写入该目录。",
    inputs: [],
    outputs: [
      {
        name: "outputDir",
        valueType: PORT_VALUE_TYPES.ABSOLUTE_PATH,
        description: "用户选择后的输出目录绝对路径。",
      },
    ],
  },
  {
    type: "user_input",
    label: "用户输入",
    summary: "用于输入多行文本（常见为 URL 列表），每行一条。",
    inputs: [],
    outputs: [
      {
        name: "text",
        valueType: PORT_VALUE_TYPES.URL_TEXT_BLOCK,
        description: "多行文本内容。",
      },
    ],
  },
  {
    type: "text_split",
    label: "文本拆数组",
    summary: "将文本拆分为字符串数组，可按换行/逗号/空白/自定义分隔。",
    inputs: [
      {
        name: "text",
        valueType: PORT_VALUE_TYPES.URL_TEXT_BLOCK,
        description: "待拆分文本。",
      },
    ],
    outputs: [
      {
        name: "items",
        valueType: PORT_VALUE_TYPES.URL_LIST,
        description: "拆分后的字符串数组(Array<string>)。",
      },
      {
        name: "count",
        valueType: PORT_VALUE_TYPES.COUNT,
        description: "拆分后的条目数量。",
      },
    ],
  },
  {
    type: "file",
    label: "读取目录",
    summary: "读取目录中的 MP4 文件，支持递归和深度限制。",
    inputs: [
      {
        name: "dir",
        valueType: PORT_VALUE_TYPES.ABSOLUTE_PATH,
        description: "待读取目录绝对路径。",
      },
    ],
    outputs: [
      {
        name: "files",
        valueType: PORT_VALUE_TYPES.ABSOLUTE_PATH_LIST,
        description: "匹配到的 MP4 文件绝对路径数组。",
      },
      {
        name: "count",
        valueType: PORT_VALUE_TYPES.COUNT,
        description: "匹配到的文件数量。",
      },
    ],
  },
  {
    type: "network",
    label: "批量下载",
    summary: "批量下载节点，可设置是否并发与并发数。",
    inputs: [
      {
        name: "urls",
        valueType: PORT_VALUE_TYPES.URL_LIST,
        description: "下载 URL 数组(Array<string>)。",
      },
      {
        name: "outputDir",
        valueType: PORT_VALUE_TYPES.ABSOLUTE_PATH,
        description: "下载输出目录绝对路径。",
      },
    ],
    outputs: [
      {
        name: "files",
        valueType: PORT_VALUE_TYPES.ABSOLUTE_PATH_LIST,
        description: "下载后文件绝对路径数组。",
      },
      {
        name: "done",
        valueType: PORT_VALUE_TYPES.COMPLETION_SIGNAL,
        description: "下载流程完成信号。",
      },
    ],
  },
  {
    type: "video",
    label: "视频拆解参数",
    summary: "输出可复用的视频拆解参数，也可直接执行自动拆解等动作。",
    inputs: [
      {
        name: "files",
        valueType: PORT_VALUE_TYPES.ABSOLUTE_PATH_LIST,
        description: "待处理视频绝对路径数组（执行动作时使用）。",
      },
      {
        name: "outputDir",
        valueType: PORT_VALUE_TYPES.ABSOLUTE_PATH,
        description: "处理输出目录绝对路径（执行动作时使用）。",
      },
      {
        name: "splitConfig",
        valueType: PORT_VALUE_TYPES.JSON_OBJECT,
        description: "上游传入的拆解参数对象（可覆盖本节点同名配置）。",
      },
    ],
    outputs: [
      {
        name: "result",
        valueType: PORT_VALUE_TYPES.RESULT_SUMMARY,
        description: "执行结果摘要（不同动作的执行状态与统计信息）。",
      },
      {
        name: "splitConfig",
        valueType: PORT_VALUE_TYPES.JSON_OBJECT,
        description: "标准化后的拆解参数对象，可复用于其它节点。",
      },
      {
        name: "files",
        valueType: PORT_VALUE_TYPES.ABSOLUTE_PATH_LIST,
        description: "执行后产出的文件绝对路径数组（动作不产出文件时为空）。",
      },
    ],
  },
  {
    type: "select_video",
    label: "选择视频",
    summary: "选择单个固定视频，常用于随机拼接的固定开头/固定结尾。",
    inputs: [],
    outputs: [
      {
        name: "videoPath",
        valueType: PORT_VALUE_TYPES.ABSOLUTE_PATH,
        description: "选择后的视频绝对路径。",
      },
    ],
  },
  {
    type: "random_concat",
    label: "随机拼接",
    summary: "从输入视频列表中随机抽取并拼接，可选固定开头/固定结尾。",
    inputs: [
      {
        name: "files",
        valueType: PORT_VALUE_TYPES.ABSOLUTE_PATH_LIST,
        description: "候选视频绝对路径数组。",
      },
      {
        name: "startVideo",
        valueType: PORT_VALUE_TYPES.ABSOLUTE_PATH,
        description: "固定开头视频绝对路径（可选）。",
      },
      {
        name: "endVideo",
        valueType: PORT_VALUE_TYPES.ABSOLUTE_PATH,
        description: "固定结尾视频绝对路径（可选）。",
      },
      {
        name: "outputDir",
        valueType: PORT_VALUE_TYPES.ABSOLUTE_PATH,
        description: "拼接输出目录绝对路径。",
      },
    ],
    outputs: [
      {
        name: "files",
        valueType: PORT_VALUE_TYPES.ABSOLUTE_PATH_LIST,
        description: "本节点生成的视频绝对路径数组。",
      },
      {
        name: "result",
        valueType: PORT_VALUE_TYPES.RESULT_SUMMARY,
        description: "拼接结果摘要文本。",
      },
    ],
  },
  {
    type: "remove_ending",
    label: "去结尾",
    summary: "根据拆解参数识别片段并移除结尾后重组视频。",
    inputs: [
      {
        name: "files",
        valueType: PORT_VALUE_TYPES.ABSOLUTE_PATH_LIST,
        description: "待处理视频绝对路径数组。",
      },
      {
        name: "splitConfig",
        valueType: PORT_VALUE_TYPES.JSON_OBJECT,
        description: "来自视频拆解参数节点的拆解算法配置。",
      },
      {
        name: "outputDir",
        valueType: PORT_VALUE_TYPES.ABSOLUTE_PATH,
        description: "处理输出目录绝对路径。",
      },
      {
        name: "newEndingVideo",
        valueType: PORT_VALUE_TYPES.ABSOLUTE_PATH,
        description: "可选的新结尾视频绝对路径。",
      },
    ],
    outputs: [
      {
        name: "files",
        valueType: PORT_VALUE_TYPES.ABSOLUTE_PATH_LIST,
        description: "去结尾后生成的视频绝对路径数组。",
      },
      {
        name: "result",
        valueType: PORT_VALUE_TYPES.RESULT_SUMMARY,
        description: "处理结果摘要文本。",
      },
    ],
  },
  {
    type: "control",
    label: "流程控制",
    summary: "流程控制与数据路由节点。",
    inputs: [
      {
        name: "in",
        valueType: PORT_VALUE_TYPES.ANY_PAYLOAD,
        description: "上游透传数据。",
      },
    ],
    outputs: [
      {
        name: "out",
        valueType: PORT_VALUE_TYPES.ANY_PAYLOAD,
        description: "控制后的输出数据。",
      },
    ],
  },
  {
    type: "custom",
    label: "自定义",
    summary: "自定义透传节点，可作为扩展占位。",
    inputs: [
      {
        name: "in",
        valueType: PORT_VALUE_TYPES.ANY_PAYLOAD,
        description: "上游透传数据。",
      },
    ],
    outputs: [
      {
        name: "out",
        valueType: PORT_VALUE_TYPES.ANY_PAYLOAD,
        description: "下游透传数据。",
      },
    ],
  },
  {
    type: "human",
    label: "人工处理",
    summary: "运行时暂停并等待人工输入。",
    inputs: [
      {
        name: "in",
        valueType: PORT_VALUE_TYPES.ANY_PAYLOAD,
        description: "待人工确认/补充的上下文。",
      },
    ],
    outputs: [
      {
        name: "out",
        valueType: PORT_VALUE_TYPES.JSON_OBJECT,
        description: "人工提交后的 JSON 数据。",
      },
    ],
    palette: false,
  },
  {
    type: "io",
    label: "IO",
    summary: "输入输出透传与字段提取节点。",
    inputs: [
      {
        name: "in",
        valueType: PORT_VALUE_TYPES.ANY_PAYLOAD,
        description: "待透传/提取的数据。",
      },
    ],
    outputs: [
      {
        name: "out",
        valueType: PORT_VALUE_TYPES.ANY_PAYLOAD,
        description: "输出数据。",
      },
    ],
    palette: false,
  },
];

export const WORKFLOW_NODE_MACRO_MAP: Record<string, WorkflowNodeMacro> = Object.fromEntries(
  WORKFLOW_NODE_MACROS.map((macro) => [macro.type, macro]),
) as Record<string, WorkflowNodeMacro>;

export const WORKFLOW_NODE_PORT_TEMPLATES: Record<string, { inputs: string[]; outputs: string[] }> = Object.fromEntries(
  WORKFLOW_NODE_MACROS.map((macro) => [
    macro.type,
    {
      inputs: macro.inputs.map((port) => port.name),
      outputs: macro.outputs.map((port) => port.name),
    },
  ]),
) as Record<string, { inputs: string[]; outputs: string[] }>;
