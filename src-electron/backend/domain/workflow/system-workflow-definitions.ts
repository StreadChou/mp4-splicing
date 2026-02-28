import { WORKFLOW_SCHEMA_VERSION, type WorkflowDefinition } from "../../shared/types";

export function createSystemWorkflowDefinitions(): WorkflowDefinition[] {
  const now = new Date().toISOString();

  return [
    {
      id: "system-batch-download",
      name: "批量下载",
      description: "用户输入文本 -> 文本拆分 -> 遍历 -> 下载",
      source: "system",
      readonly: false,
      schemaVersion: WORKFLOW_SCHEMA_VERSION,
      systemKind: "batch_download",
      createdAt: now,
      updatedAt: now,
      graph: {
        nodes: [
          {
            id: "user_urls",
            type: "user_input",
            config: {
              text: "",
            },
            position: { x: 100, y: 100 },
          },
          {
            id: "output_dir",
            type: "output_dir",
            config: {},
            position: { x: 100, y: 360 },
          },
          {
            id: "text_to_array",
            type: "text_split",
            config: {
              mode: "newline",
              trim: true,
              removeEmpty: true,
            },
            position: { x: 520, y: 100 },
          },
          {
            id: "loop",
            type: "iterate",
            config: {
              concurrency: 3,
            },
            position: { x: 960, y: 100 },
          },
          {
            id: "download",
            type: "download",
            config: {},
            position: { x: 1400, y: 220 },
          },
        ],
        edges: [
          { id: "e1", source: "user_urls", target: "text_to_array", sourceHandle: "out-0", targetHandle: "in-0" },
          { id: "e2", source: "text_to_array", target: "loop", sourceHandle: "out-0", targetHandle: "in-0" },
          { id: "e3", source: "loop", target: "download", sourceHandle: "out-0", targetHandle: "in-0" },
          { id: "e4", source: "output_dir", target: "download", sourceHandle: "out-0", targetHandle: "in-1" },
        ],
      },
    },
    {
      id: "system-video-concat",
      name: "视频拼接",
      description: "输入目录 -> 读取 MP4 -> 循环(固定次数) -> 视频组合",
      source: "system",
      readonly: false,
      schemaVersion: WORKFLOW_SCHEMA_VERSION,
      systemKind: "concat",
      createdAt: now,
      updatedAt: now,
      graph: {
        nodes: [
          {
            id: "input_dir",
            type: "input_dir",
            config: {},
            position: { x: 100, y: 100 },
          },
          {
            id: "output_dir",
            type: "output_dir",
            config: {},
            position: { x: 100, y: 600 },
          },
          {
            id: "read_dir",
            type: "read_mp4_files",
            config: {
              recursive: true,
              maxDepth: 2,
            },
            position: { x: 520, y: 100 },
          },
          {
            id: "fixed_start",
            type: "select_video",
            config: {
              videoPath: "",
            },
            position: { x: 520, y: 340 },
          },
          {
            id: "fixed_end",
            type: "select_video",
            config: {
              videoPath: "",
            },
            position: { x: 520, y: 580 },
          },
          {
            id: "loop",
            type: "repeat",
            config: {
              concurrency: 1,
              times: 1,
            },
            position: { x: 960, y: 100 },
          },
          {
            id: "compose_videos",
            type: "compose_videos",
            config: {
              shuffle: false,
            },
            position: { x: 1400, y: 320 },
          },
        ],
        edges: [
          { id: "e1", source: "input_dir", target: "read_dir", sourceHandle: "out-0", targetHandle: "in-0" },
          { id: "e2", source: "read_dir", target: "loop", sourceHandle: "out-0", targetHandle: "in-0" },
          { id: "e3", source: "loop", target: "compose_videos", sourceHandle: "out-0", targetHandle: "in-0" },
          { id: "e4", source: "fixed_start", target: "compose_videos", sourceHandle: "out-0", targetHandle: "in-1" },
          { id: "e5", source: "fixed_end", target: "compose_videos", sourceHandle: "out-0", targetHandle: "in-2" },
          { id: "e6", source: "output_dir", target: "compose_videos", sourceHandle: "out-0", targetHandle: "in-3" },
        ],
      },
    },
    {
      id: "system-remove-ending",
      name: "去结尾",
      description: "输入目录 -> 逐视频遍历拆解 -> 逐视频组合（可选替换结尾）",
      source: "system",
      readonly: false,
      schemaVersion: WORKFLOW_SCHEMA_VERSION,
      systemKind: "remove_ending",
      createdAt: now,
      updatedAt: now,
      graph: {
        nodes: [
          {
            id: "input_dir",
            type: "input_dir",
            config: {},
            position: { x: 100, y: 100 },
          },
          {
            id: "split_output_dir",
            type: "output_dir",
            config: {},
            position: { x: 100, y: 340 },
          },
          {
            id: "compose_output_dir",
            type: "output_dir",
            config: {},
            position: { x: 100, y: 580 },
          },
          {
            id: "read_dir",
            type: "read_mp4_files",
            config: {
              recursive: false,
              maxDepth: 0,
            },
            position: { x: 520, y: 100 },
          },
          {
            id: "split_algo",
            type: "split_algo_ssim",
            config: {
              threshold: 0.7,
              minDuration: 2,
            },
            position: { x: 520, y: 340 },
          },
          {
            id: "loop",
            type: "iterate",
            config: {
              concurrency: 2,
            },
            position: { x: 960, y: 100 },
          },
          {
            id: "new_ending",
            type: "select_video",
            config: {
              videoPath: "",
            },
            position: { x: 960, y: 580 },
          },
          {
            id: "split_compose_per_video",
            type: "split_compose_per_video",
            config: {
              dropHead: false,
              dropTail: true,
              shuffle: true,
            },
            position: { x: 1400, y: 260 },
          },
        ],
        edges: [
          { id: "e1", source: "input_dir", target: "read_dir", sourceHandle: "out-0", targetHandle: "in-0" },
          { id: "e2", source: "read_dir", target: "loop", sourceHandle: "out-0", targetHandle: "in-0" },
          { id: "e3", source: "loop", target: "split_compose_per_video", sourceHandle: "out-0", targetHandle: "in-0" },
          { id: "e4", source: "split_output_dir", target: "split_compose_per_video", sourceHandle: "out-0", targetHandle: "in-1" },
          { id: "e5", source: "compose_output_dir", target: "split_compose_per_video", sourceHandle: "out-0", targetHandle: "in-2" },
          { id: "e6", source: "split_algo", target: "split_compose_per_video", sourceHandle: "out-0", targetHandle: "in-3" },
          { id: "e7", source: "new_ending", target: "split_compose_per_video", sourceHandle: "out-0", targetHandle: "in-4" },
        ],
      },
    },
    {
      id: "system-auto-split",
      name: "自动拆解",
      description: "输入目录 -> 读取 MP4 -> 遍历 -> 自动拆解",
      source: "system",
      readonly: false,
      schemaVersion: WORKFLOW_SCHEMA_VERSION,
      systemKind: "auto_split",
      createdAt: now,
      updatedAt: now,
      graph: {
        nodes: [
          {
            id: "input_dir",
            type: "input_dir",
            config: {},
            position: { x: 100, y: 120 },
          },
          {
            id: "output_dir",
            type: "output_dir",
            config: {},
            position: { x: 100, y: 360 },
          },
          {
            id: "read_dir",
            type: "read_mp4_files",
            config: {
              recursive: true,
              maxDepth: 2,
            },
            position: { x: 520, y: 120 },
          },
          {
            id: "split_algo",
            type: "split_algo_ssim",
            config: {
              threshold: 0.7,
              minDuration: 2,
            },
            position: { x: 520, y: 360 },
          },
          {
            id: "loop",
            type: "iterate",
            config: {
              concurrency: 2,
            },
            position: { x: 960, y: 120 },
          },
          {
            id: "auto_split",
            type: "auto_split",
            config: {
              dropHead: false,
              dropTail: false,
            },
            position: { x: 1400, y: 240 },
          },
        ],
        edges: [
          { id: "e1", source: "input_dir", target: "read_dir", sourceHandle: "out-0", targetHandle: "in-0" },
          { id: "e2", source: "read_dir", target: "loop", sourceHandle: "out-0", targetHandle: "in-0" },
          { id: "e3", source: "loop", target: "auto_split", sourceHandle: "out-0", targetHandle: "in-0" },
          { id: "e4", source: "output_dir", target: "auto_split", sourceHandle: "out-0", targetHandle: "in-1" },
          { id: "e5", source: "split_algo", target: "auto_split", sourceHandle: "out-0", targetHandle: "in-2" },
        ],
      },
    },
    {
      id: "system-auto-split-concat",
      name: "自动拆解并拼接",
      description: "输入目录 -> 全量拆解 -> 循环(固定次数)组合",
      source: "system",
      readonly: false,
      schemaVersion: WORKFLOW_SCHEMA_VERSION,
      systemKind: "auto_split_concat",
      createdAt: now,
      updatedAt: now,
      graph: {
        nodes: [
          {
            id: "input_dir",
            type: "input_dir",
            config: {},
            position: { x: 100, y: 100 },
          },
          {
            id: "split_output_dir",
            type: "output_dir",
            config: {},
            position: { x: 100, y: 340 },
          },
          {
            id: "concat_output_dir",
            type: "output_dir",
            config: {},
            position: { x: 100, y: 580 },
          },
          {
            id: "read_dir",
            type: "read_mp4_files",
            config: {
              recursive: true,
              maxDepth: 2,
            },
            position: { x: 520, y: 100 },
          },
          {
            id: "split_algo",
            type: "split_algo_ssim",
            config: {
              threshold: 0.7,
              minDuration: 2,
            },
            position: { x: 520, y: 340 },
          },
          {
            id: "auto_split",
            type: "auto_split",
            config: {
              dropHead: false,
              dropTail: false,
            },
            position: { x: 960, y: 160 },
          },
          {
            id: "fixed_start",
            type: "select_video",
            config: {
              videoPath: "",
            },
            position: { x: 960, y: 420 },
          },
          {
            id: "fixed_end",
            type: "select_video",
            config: {
              videoPath: "",
            },
            position: { x: 960, y: 660 },
          },
          {
            id: "loop",
            type: "repeat",
            config: {
              concurrency: 1,
              times: 1,
            },
            position: { x: 1400, y: 160 },
          },
          {
            id: "compose_videos",
            type: "compose_videos",
            config: {
              shuffle: true,
            },
            position: { x: 1840, y: 360 },
          },
        ],
        edges: [
          { id: "e1", source: "input_dir", target: "read_dir", sourceHandle: "out-0", targetHandle: "in-0" },
          { id: "e2", source: "read_dir", target: "auto_split", sourceHandle: "out-0", targetHandle: "in-0" },
          { id: "e3", source: "split_output_dir", target: "auto_split", sourceHandle: "out-0", targetHandle: "in-1" },
          { id: "e4", source: "split_algo", target: "auto_split", sourceHandle: "out-0", targetHandle: "in-2" },
          { id: "e5", source: "auto_split", target: "loop", sourceHandle: "out-0", targetHandle: "in-0" },
          { id: "e6", source: "loop", target: "compose_videos", sourceHandle: "out-0", targetHandle: "in-0" },
          { id: "e7", source: "fixed_start", target: "compose_videos", sourceHandle: "out-0", targetHandle: "in-1" },
          { id: "e8", source: "fixed_end", target: "compose_videos", sourceHandle: "out-0", targetHandle: "in-2" },
          { id: "e9", source: "concat_output_dir", target: "compose_videos", sourceHandle: "out-0", targetHandle: "in-3" },
        ],
      },
    },
    {
      id: "system-download-auto-split",
      name: "下载并自动拆解",
      description: "输入文本后遍历下载，再自动拆解下载结果",
      source: "system",
      readonly: false,
      schemaVersion: WORKFLOW_SCHEMA_VERSION,
      systemKind: "download_auto_split",
      createdAt: now,
      updatedAt: now,
      graph: {
        nodes: [
          {
            id: "user_urls",
            type: "user_input",
            config: {
              text: "",
            },
            position: { x: 100, y: 100 },
          },
          {
            id: "download_output_dir",
            type: "output_dir",
            config: {},
            position: { x: 100, y: 340 },
          },
          {
            id: "split_output_dir",
            type: "output_dir",
            config: {},
            position: { x: 100, y: 580 },
          },
          {
            id: "text_to_array",
            type: "text_split",
            config: {
              mode: "newline",
              trim: true,
              removeEmpty: true,
            },
            position: { x: 520, y: 100 },
          },
          {
            id: "loop",
            type: "iterate",
            config: {
              concurrency: 3,
            },
            position: { x: 960, y: 100 },
          },
          {
            id: "download",
            type: "download",
            config: {},
            position: { x: 1400, y: 220 },
          },
          {
            id: "split_algo",
            type: "split_algo_ssim",
            config: {
              threshold: 0.7,
              minDuration: 2,
            },
            position: { x: 960, y: 580 },
          },
          {
            id: "auto_split",
            type: "auto_split",
            config: {
              dropHead: false,
              dropTail: false,
            },
            position: { x: 1840, y: 360 },
          },
        ],
        edges: [
          { id: "e1", source: "user_urls", target: "text_to_array", sourceHandle: "out-0", targetHandle: "in-0" },
          { id: "e2", source: "text_to_array", target: "loop", sourceHandle: "out-0", targetHandle: "in-0" },
          { id: "e3", source: "loop", target: "download", sourceHandle: "out-0", targetHandle: "in-0" },
          { id: "e4", source: "download_output_dir", target: "download", sourceHandle: "out-0", targetHandle: "in-1" },
          { id: "e5", source: "download", target: "auto_split", sourceHandle: "out-1", targetHandle: "in-0" },
          { id: "e6", source: "split_output_dir", target: "auto_split", sourceHandle: "out-0", targetHandle: "in-1" },
          { id: "e7", source: "split_algo", target: "auto_split", sourceHandle: "out-0", targetHandle: "in-2" },
        ],
      },
    },
  ];
}
