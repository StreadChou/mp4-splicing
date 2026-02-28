import { NodeFieldType, NodeType, PortDataType, PortDirection, SplitAlgorithmKind } from "../enums";
import type { NodeDefinition } from "../types";

export const SPLIT_ALGO_SSIM_NODE: NodeDefinition = {
  type: NodeType.SPLIT_ALGO_SSIM,
  name: "SSIM拆解算法",
  summary: "输出 SSIM 拆解算法配置。",
  palette: true,
  ports: [
    {
      name: "splitAlgorithm",
      direction: PortDirection.OUTPUT,
      valueType: PortDataType.VIDEO_SPLIT_ALGORITHM,
      required: true,
      description: "拆解算法配置对象。",
    },
  ],
  fields: [
    {
      key: "threshold",
      label: "阈值",
      type: NodeFieldType.NUMBER,
      required: true,
      defaultValue: 0.7,
      min: 0,
      max: 1,
      step: 0.01,
    },
    {
      key: "minDuration",
      label: "最小时长",
      type: NodeFieldType.NUMBER,
      required: true,
      defaultValue: 2,
      min: 0,
      step: 0.1,
    },
  ],
  defaults: {
    algorithm: SplitAlgorithmKind.SSIM,
    threshold: 0.7,
    minDuration: 2,
  },
  runtime: {
    executor: "split_algo_ssim",
  },
};
