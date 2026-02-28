import { AUTO_SPLIT_NODE } from "./auto-split";
import { COMPOSE_VIDEOS_NODE } from "./compose-videos";
import { CONTROL_NODE } from "./control";
import { DOWNLOAD_NODE } from "./download";
import { HUMAN_INPUT_NODE } from "./human-input";
import { INPUT_DIR_NODE } from "./input-dir";
import { ITERATE_NODE } from "./iterate";
import { IO_PASS_NODE } from "./io-pass";
import { OUTPUT_DIR_NODE } from "./output-dir";
import { READ_MP4_FILES_NODE } from "./read-mp4-files";
import { REPEAT_NODE } from "./repeat";
import { SELECT_VIDEO_NODE } from "./select-video";
import { SPLIT_COMPOSE_PER_VIDEO_NODE } from "./split-compose-per-video";
import { SPLIT_ALGO_FRAME_DIFF_NODE } from "./split-algo-frame-diff";
import { SPLIT_ALGO_HISTOGRAM_NODE } from "./split-algo-histogram";
import { SPLIT_ALGO_SSIM_NODE } from "./split-algo-ssim";
import { TEXT_SPLIT_NODE } from "./text-split";
import { USER_INPUT_NODE } from "./user-input";

export const NODE_DEFINITIONS = [
  INPUT_DIR_NODE,
  OUTPUT_DIR_NODE,
  USER_INPUT_NODE,
  TEXT_SPLIT_NODE,
  READ_MP4_FILES_NODE,
  DOWNLOAD_NODE,
  ITERATE_NODE,
  REPEAT_NODE,
  SPLIT_ALGO_SSIM_NODE,
  SPLIT_ALGO_HISTOGRAM_NODE,
  SPLIT_ALGO_FRAME_DIFF_NODE,
  SPLIT_COMPOSE_PER_VIDEO_NODE,
  AUTO_SPLIT_NODE,
  SELECT_VIDEO_NODE,
  COMPOSE_VIDEOS_NODE,
  HUMAN_INPUT_NODE,
  IO_PASS_NODE,
  CONTROL_NODE,
];
