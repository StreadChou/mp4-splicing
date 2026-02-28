import { NodeFieldType, NodeType, PortDataType, PortDirection } from "../enums";
import type { NodeDefinition } from "../types";

export const SELECT_VIDEO_NODE: NodeDefinition = {
  type: NodeType.SELECT_VIDEO,
  name: "选择视频",
  summary: "手动选择单个视频作为开头或结尾。",
  palette: true,
  ports: [
    {
      name: "videoPath",
      direction: PortDirection.OUTPUT,
      valueType: PortDataType.ABSOLUTE_PATH,
      required: false,
      description: "可选视频路径。",
    },
  ],
  fields: [
    {
      key: "videoPath",
      label: "视频路径",
      type: NodeFieldType.VIDEO,
      required: false,
      placeholder: "/path/to/video.mp4",
    },
  ],
  defaults: {
    videoPath: "",
  },
  runtime: {
    executor: "select_video",
  },
};
