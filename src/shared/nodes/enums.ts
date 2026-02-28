/** 工作流节点类型枚举。 */
export enum NodeType {
  /** 输入目录节点。 */
  INPUT_DIR = "input_dir",
  /** 输出目录节点。 */
  OUTPUT_DIR = "output_dir",
  /** 用户文本输入节点。 */
  USER_INPUT = "user_input",
  /** 文本拆分节点。 */
  TEXT_SPLIT = "text_split",
  /** 读取 MP4 文件列表节点。 */
  READ_MP4_FILES = "read_mp4_files",
  /** 下载节点。 */
  DOWNLOAD = "download",
  /** 遍历节点（数组 -> 单项）。 */
  ITERATE = "iterate",
  /** 固定次数循环节点。 */
  REPEAT = "repeat",
  /** 收集节点（汇总循环产物）。 */
  COLLECT = "collect",
  /** 旧版批量下载类型（兼容历史数据）。 */
  BATCH_DOWNLOAD = "batch_download",
  /** SSIM 拆解算法节点。 */
  SPLIT_ALGO_SSIM = "split_algo_ssim",
  /** 直方图拆解算法节点。 */
  SPLIT_ALGO_HISTOGRAM = "split_algo_histogram",
  /** 帧差拆解算法节点。 */
  SPLIT_ALGO_FRAME_DIFF = "split_algo_frame_diff",
  /** 单视频拆解并组合节点。 */
  SPLIT_COMPOSE_PER_VIDEO = "split_compose_per_video",
  /** 自动拆解节点。 */
  AUTO_SPLIT = "auto_split",
  /** 选择视频节点。 */
  SELECT_VIDEO = "select_video",
  /** 视频组合节点。 */
  COMPOSE_VIDEOS = "compose_videos",
  /** 人工输入节点。 */
  HUMAN_INPUT = "human_input",
  /** IO 透传节点。 */
  IO_PASS = "io_pass",
  /** 控制路由节点。 */
  CONTROL = "control",
}

/** 端口方向枚举。 */
export enum PortDirection {
  /** 输入端口。 */
  INPUT = "input",
  /** 输出端口。 */
  OUTPUT = "output",
}

/** 端口基础数据类型枚举。 */
export enum PortDataType {
  /** 绝对路径字符串。 */
  ABSOLUTE_PATH = "AbsolutePath",
  /** 纯文本字符串。 */
  PLAIN_TEXT = "PlainText",
  /** 计数值（number）。 */
  COUNT = "Count",
  /** 完成信号（boolean/状态信号）。 */
  COMPLETION_SIGNAL = "CompletionSignal",
  /** 执行结果摘要文本。 */
  RESULT_SUMMARY = "ResultSummary",
  /** 任意结构数据。 */
  ANY_PAYLOAD = "AnyPayload",
  /** JSON 对象数据。 */
  JSON_OBJECT = "JsonObject",
  /** 视频拆解算法配置对象。 */
  VIDEO_SPLIT_ALGORITHM = "VideoSplitAlgorithm",
}

/** 节点配置字段类型枚举。 */
export enum NodeFieldType {
  /** 单行文本。 */
  TEXT = "text",
  /** 多行文本。 */
  TEXTAREA = "textarea",
  /** 数值输入。 */
  NUMBER = "number",
  /** 布尔开关。 */
  BOOLEAN = "boolean",
  /** 下拉选择。 */
  SELECT = "select",
  /** 目录选择器。 */
  DIRECTORY = "directory",
  /** 视频文件选择器。 */
  VIDEO = "video",
  /** JSON 输入。 */
  JSON = "json",
}

/** 视频拆解算法类型。 */
export enum SplitAlgorithmKind {
  /** SSIM 算法。 */
  SSIM = "ssim",
  /** 直方图算法。 */
  HISTOGRAM = "histogram",
  /** 帧差算法。 */
  FRAME_DIFF = "frame_diff",
}

/** 循环模式（用于运行时元信息）。 */
export enum LoopMode {
  /** 遍历数组项。 */
  ITERATE_ITEMS = "iterate_items",
  /** 固定次数循环。 */
  FIXED_TIMES = "fixed_times",
}
