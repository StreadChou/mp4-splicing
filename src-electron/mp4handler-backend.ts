import { app, type WebContents } from "electron";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import jpeg from "jpeg-js";
import { deleteTaskRuntime, readTaskRuntime, writeTaskRuntime } from "./backend/infra/runtime/task-runtime-store";
import {
  getTasksFromStore,
  getWorkflowsFromStore,
  setTasksToStore,
  setWorkflowsToStore,
} from "./backend/infra/store/workflow-store";
import {
  type InteractionRequest,
  type WorkflowDefinition,
  type WorkflowGraph,
  type WorkflowMeta,
  type WorkflowTaskRecord,
  type WorkflowTaskStatus,
  WORKFLOW_SCHEMA_VERSION,
} from "./backend/shared/types";
import {
  normalizeWorkflowGraph,
  validateWorkflowGraphStructure,
  validateWorkflowRunConfig,
} from "./backend/domain/graph/graph-schema";
import type { NodeExecutionDeps } from "./backend/domain/graph/node-execution";
import { executeWorkflowGraph } from "./backend/domain/graph/graph-executor";

interface VideoInfo {
  codec: string;
  width: number;
  height: number;
  fps: string;
  duration: number;
  has_audio: boolean;
}

interface CompatibilityResult {
  compatible: boolean;
  message: string;
  videos_info: Array<[string, VideoInfo]>;
}

interface VideoMetadata {
  width: number;
  height: number;
  fps: number;
  duration: number;
  total_frames: number;
  codec: string;
}

interface FrameInfo {
  frame_number: number;
  timestamp: number;
  image_path: string;
}

interface SegmentRange {
  start_frame: number;
  end_frame: number;
}

interface VideoTask {
  path: string;
  name: string;
  status: string;
}

interface BatchProgress {
  input_dir: string;
  output_dir: string;
  tasks: VideoTask[];
  current_index: number;
}

interface DownloadProgress {
  url: string;
  progress: number;
  speed: string;
  status: "pending" | "downloading" | "completed" | "failed";
}

interface VideoPoolState {
  allVideos: string[];
  remainingVideos: string[];
}

class VideoPoolManager {
  private pools = new Map<string, VideoPoolState>();

  private makeKey(inputDir: string, maxDepth: number): string {
    return `${inputDir}::${maxDepth}`;
  }

  getOrCreatePool(inputDir: string, maxDepth: number, allVideos: string[]): VideoPoolState {
    const key = this.makeKey(inputDir, maxDepth);
    const oldPool = this.pools.get(key);

    if (oldPool && oldPool.allVideos.length === allVideos.length) {
      return {
        allVideos: [...oldPool.allVideos],
        remainingVideos: [...oldPool.remainingVideos],
      };
    }

    const newPool: VideoPoolState = {
      allVideos: [...allVideos],
      remainingVideos: [...allVideos],
    };
    this.pools.set(key, newPool);
    return { ...newPool, allVideos: [...newPool.allVideos], remainingVideos: [...newPool.remainingVideos] };
  }

  drawVideos(inputDir: string, maxDepth: number, count: number): string[] {
    const key = this.makeKey(inputDir, maxDepth);
    const pool = this.pools.get(key);

    if (!pool) {
      throw new Error("视频池不存在，请先初始化");
    }

    if (pool.remainingVideos.length === 0) {
      pool.remainingVideos = [...pool.allVideos];
    }

    shuffleArray(pool.remainingVideos);
    return pool.remainingVideos.splice(0, Math.min(count, pool.remainingVideos.length));
  }

  getRemainingCount(inputDir: string, maxDepth: number): number {
    const key = this.makeKey(inputDir, maxDepth);
    return this.pools.get(key)?.remainingVideos.length ?? 0;
  }
}

const currentDir = fileURLToPath(new URL(".", import.meta.url));
const videoPoolManager = new VideoPoolManager();
const binaryCache = new Map<"ffmpeg" | "ffprobe", string>();

function emitEvent(sender: WebContents, event: string, payload: unknown): void {
  sender.send("mp4handler:event", { event, payload });
}

function shuffleArray<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j] as T, arr[i] as T];
  }
}

function formatNowStamp(): string {
  const d = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(
    d.getMinutes(),
  )}${pad(d.getSeconds())}`;
}

function parseRational(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "N/A") {
    return null;
  }

  if (trimmed.includes("/")) {
    const [num, den] = trimmed.split("/");
    const n = Number(num);
    const d = Number(den);
    if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) {
      return null;
    }
    return n / d;
  }

  const direct = Number(trimmed);
  return Number.isFinite(direct) ? direct : null;
}

function normalizeTimestamps(raw: number[]): number[] {
  const timestamps = [...raw];
  let last = 0;

  for (let i = 0; i < timestamps.length; i++) {
    const ts = timestamps[i] as number;
    if (!Number.isFinite(ts) || ts < 0) {
      timestamps[i] = last;
    } else if (ts < last) {
      timestamps[i] = last;
    } else {
      last = ts;
    }
  }

  const first = timestamps[0];
  if (typeof first === "number" && first > 0) {
    for (let i = 0; i < timestamps.length; i++) {
      const shifted = (timestamps[i] as number) - first;
      timestamps[i] = shifted > 0 ? shifted : 0;
    }
  }

  return timestamps;
}

function calculateHash(value: string): string {
  return crypto.createHash("sha1").update(value).digest("hex");
}

async function ensureDir(dirPath: string): Promise<void> {
  await fsp.mkdir(dirPath, { recursive: true });
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await fsp.access(targetPath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function cleanupPathQuietly(targetPath: string): Promise<void> {
  await fsp.rm(targetPath, { recursive: true, force: true }).catch(() => void 0);
}

function isMp4File(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === ".mp4";
}

async function collectVideos(dirPath: string, maxDepth: number): Promise<string[]> {
  const stat = await fsp.stat(dirPath).catch(() => null);
  if (!stat) {
    throw new Error(`目录不存在: ${dirPath}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`路径不是目录: ${dirPath}`);
  }

  const results: string[] = [];

  async function walk(current: string, depth: number): Promise<void> {
    const entries = await fsp.readdir(current, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isFile() && isMp4File(fullPath)) {
        results.push(fullPath);
      } else if (entry.isDirectory() && depth < maxDepth) {
        await walk(fullPath, depth + 1);
      }
    }
  }

  await walk(dirPath, 0);

  if (results.length === 0) {
    throw new Error(`在目录中未找到 MP4 文件: ${dirPath}`);
  }

  results.sort();
  return results;
}

function resolveBundledBinary(name: "ffmpeg" | "ffprobe"): string | null {
  const platform = process.platform;
  const arch = process.arch;

  const suffixMap: Record<string, string> = {
    "darwin-arm64": "aarch64-apple-darwin",
    "win32-x64": "x86_64-pc-windows-msvc.exe",
  };

  const key = `${platform}-${arch}`;
  const suffix = suffixMap[key];
  if (!suffix) {
    return null;
  }

  const baseName = platform === "win32" ? `${name}-${suffix}` : `${name}-${suffix}`;
  const devCandidate = path.resolve(currentDir, "../../src-electron/bin", baseName);
  if (fs.existsSync(devCandidate)) {
    return devCandidate;
  }

  const packagedCandidate = path.resolve(process.resourcesPath, "src-electron/bin", baseName);
  if (fs.existsSync(packagedCandidate)) {
    return packagedCandidate;
  }

  return null;
}

async function resolveBinary(name: "ffmpeg" | "ffprobe"): Promise<string> {
  const cached = binaryCache.get(name);
  if (cached) {
    return cached;
  }

  const localBinary = resolveBundledBinary(name);
  if (localBinary) {
    if (process.platform !== "win32") {
      await fsp.chmod(localBinary, 0o755).catch(() => void 0);
    }
    binaryCache.set(name, localBinary);
    return localBinary;
  }

  binaryCache.set(name, name);
  return name;
}

interface CommandOutput {
  stdout: string;
  stderr: string;
}

async function runCommand(command: string, args: string[]): Promise<CommandOutput> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(new Error(error.message));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(stderr || `命令执行失败，退出码: ${String(code)}`));
      }
    });
  });
}

async function runFfmpeg(args: string[]): Promise<CommandOutput> {
  const ffmpeg = await resolveBinary("ffmpeg");
  try {
    return await runCommand(ffmpeg, args);
  } catch (error) {
    const hint = `FFmpeg 执行失败: ${String(error)}`;
    throw new Error(hint);
  }
}

async function runFfprobe(args: string[]): Promise<CommandOutput> {
  const ffprobe = await resolveBinary("ffprobe");
  try {
    return await runCommand(ffprobe, args);
  } catch (error) {
    const hint = `FFprobe 执行失败: ${String(error)}`;
    throw new Error(hint);
  }
}

async function getVideoInfo(videoPath: string): Promise<VideoInfo> {
  const { stdout } = await runFfprobe([
    "-v",
    "error",
    "-show_entries",
    "stream=codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate",
    "-show_entries",
    "format=duration",
    "-of",
    "json",
    videoPath,
  ]);

  const json = JSON.parse(stdout) as {
    streams?: Array<Record<string, unknown>>;
    format?: Record<string, unknown>;
  };

  const streams = json.streams ?? [];
  const videoStream = streams.find((stream) => stream.codec_type === "video");
  const audioStream = streams.find((stream) => stream.codec_type === "audio");

  if (!videoStream) {
    throw new Error("未找到视频流信息");
  }

  const width = Number(videoStream.width ?? 0);
  const height = Number(videoStream.height ?? 0);
  const codec = String(videoStream.codec_name ?? "unknown");
  const avgFrameRate = String(videoStream.avg_frame_rate ?? "N/A");
  const rFrameRate = String(videoStream.r_frame_rate ?? "N/A");
  const fps = avgFrameRate !== "N/A" && avgFrameRate !== "" ? avgFrameRate : rFrameRate;
  const durationFromFormat = Number(json.format?.duration ?? 0);
  const duration = Number.isFinite(durationFromFormat) && durationFromFormat > 0 ? durationFromFormat : 0;

  return {
    codec,
    width,
    height,
    fps,
    duration,
    has_audio: Boolean(audioStream),
  };
}

async function checkVideoCompatibility(videos: string[]): Promise<CompatibilityResult> {
  const videosInfo: Array<[string, VideoInfo]> = [];

  for (const video of videos) {
    const info = await getVideoInfo(video);
    videosInfo.push([path.basename(video), info]);
  }

  if (videosInfo.length === 0) {
    return {
      compatible: true,
      message: "没有视频需要检测",
      videos_info: videosInfo,
    };
  }

  const issues: string[] = [];
  for (const [name, info] of videosInfo) {
    if (!info.width || !info.height) {
      issues.push(`${name}: 无法解析分辨率`);
    }
    if (!(info.duration > 0)) {
      issues.push(`${name}: 无法解析时长`);
    }
  }

  if (issues.length > 0) {
    return {
      compatible: false,
      message: `检测到兼容性问题:\n${issues.join("\n")}`,
      videos_info: videosInfo,
    };
  }

  return {
    compatible: true,
    message: "视频信息解析完成，将统一重编码以保证音画同步",
    videos_info: videosInfo,
  };
}

async function checkVideoCompatibilityForPaths(videoPaths: string[]): Promise<Array<[string, VideoInfo]>> {
  const videosInfo: Array<[string, VideoInfo]> = [];

  for (const video of videoPaths) {
    const info = await getVideoInfo(video);
    if (!info.width || !info.height) {
      throw new Error(`${path.basename(video)}: 无法解析分辨率`);
    }
    if (!(info.duration > 0)) {
      throw new Error(`${path.basename(video)}: 无法解析时长`);
    }
    videosInfo.push([path.basename(video), info]);
  }

  return videosInfo;
}

function buildConcatFilter(
  videosInfo: Array<[string, VideoInfo]>,
  targetWidth: number,
  targetHeight: number,
): string {
  const parts: string[] = [];

  videosInfo.forEach(([_, info], idx) => {
    parts.push(
      `[${idx}:v]scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p,setpts=PTS-STARTPTS[v${idx}]`,
    );

    if (info.has_audio) {
      parts.push(
        `[${idx}:a]aresample=async=1:first_pts=0,aformat=sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS[a${idx}]`,
      );
    } else {
      if (!(info.duration > 0)) {
        throw new Error(`无法获取第 ${idx + 1} 个视频时长，无法补齐静音音轨`);
      }
      parts.push(
        `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${info.duration.toFixed(6)},asetpts=PTS-STARTPTS[a${idx}]`,
      );
    }
  });

  const concatInputs = videosInfo.map((_, idx) => `[v${idx}][a${idx}]`).join("");
  parts.push(`${concatInputs}concat=n=${videosInfo.length}:v=1:a=1[outv][outa]`);

  return parts.join(";");
}

async function concatVideosInternal(
  sender: WebContents,
  params: {
    inputDir: string;
    files?: string[];
    startingVideo?: string | null;
    endingVideo: string | null;
    randomCountMin: number;
    randomCountMax: number;
    maxDepth: number;
    runTimes: number;
    outputDir: string;
  },
): Promise<{ message: string; outputPaths: string[] }> {
  const { inputDir, files, startingVideo, endingVideo, randomCountMin, randomCountMax, maxDepth, runTimes, outputDir } = params;

  const explicitFiles = Array.from(
    new Set((files ?? []).map((item) => String(item).trim()).filter((item) => item.length > 0).map((item) => path.resolve(item))),
  );

  if (!inputDir && explicitFiles.length === 0) {
    throw new Error("输入目录与候选视频列表不能同时为空");
  }
  if (!outputDir) {
    throw new Error("输出目录不能为空");
  }
  if (randomCountMin <= 0 || randomCountMax <= 0) {
    throw new Error("随机数量必须大于 0");
  }
  if (randomCountMin > randomCountMax) {
    throw new Error("随机数量范围不合法");
  }
  if (runTimes <= 0) {
    throw new Error("执行次数必须大于 0");
  }

  await ensureDir(outputDir);
  let allVideos: string[] = [];
  let poolInputKey = inputDir;
  let poolDepth = maxDepth;
  if (explicitFiles.length > 0) {
    emitEvent(sender, "progress", `读取到 ${String(explicitFiles.length)} 个候选视频，开始随机拼接...`);
    for (const candidate of explicitFiles) {
      if (!(await fileExists(candidate))) {
        throw new Error(`候选视频不存在: ${candidate}`);
      }
    }
    allVideos = explicitFiles;
    poolInputKey = `explicit_files_${calculateHash(allVideos.join("|"))}`;
    poolDepth = 0;
  } else {
    emitEvent(sender, "progress", "正在扫描视频文件...");
    allVideos = await collectVideos(inputDir, maxDepth);
  }
  const availableCount = allVideos.length;
  if (availableCount === 0) {
    throw new Error(explicitFiles.length > 0 ? "候选视频列表为空" : `在目录中未找到 MP4 文件: ${inputDir}`);
  }

  videoPoolManager.getOrCreatePool(poolInputKey, poolDepth, allVideos);

  const outputPaths: string[] = [];
  const baseTimestamp = formatNowStamp();

  for (let runIndex = 1; runIndex <= runTimes; runIndex++) {
    const desiredCount =
      randomCountMin === randomCountMax
        ? randomCountMin
        : randomCountMin + Math.floor(Math.random() * (randomCountMax - randomCountMin + 1));

    const actualCount = Math.min(desiredCount, availableCount);
    const videos = videoPoolManager.drawVideos(poolInputKey, poolDepth, actualCount);

    if (desiredCount > availableCount) {
      emitEvent(
        sender,
        "progress",
        `第 ${runIndex}/${runTimes} 次：请求 ${desiredCount} 个视频，但只找到 ${availableCount} 个，将使用全部 ${availableCount} 个视频`,
      );
    } else {
      const remaining = videoPoolManager.getRemainingCount(poolInputKey, poolDepth);
      const msg =
        remaining + videos.length === availableCount
          ? `第 ${runIndex}/${runTimes} 次：池子已抽完，重新填充。本次选择 ${videos.length} 个视频`
          : `第 ${runIndex}/${runTimes} 次：已选择 ${videos.length} 个视频（池子剩余 ${remaining}）`;
      emitEvent(sender, "progress", msg);
    }

    if (startingVideo) {
      const startingPath = path.resolve(startingVideo);
      if (!(await fileExists(startingPath))) {
        throw new Error(`固定开头视频不存在: ${startingPath}`);
      }
      videos.unshift(startingPath);
      emitEvent(sender, "progress", "已添加固定开头视频");
    }

    if (endingVideo) {
      const endingPath = path.resolve(endingVideo);
      if (!(await fileExists(endingPath))) {
        throw new Error(`结尾视频不存在: ${endingPath}`);
      }
      videos.push(endingPath);
      emitEvent(sender, "progress", "已添加结尾视频");
    }

    emitEvent(sender, "progress", `第 ${runIndex}/${runTimes} 次：正在检测视频兼容性...`);
    const compatibility = await checkVideoCompatibility(videos);

    if (!compatibility.compatible) {
      throw new Error(`INCOMPATIBLE_VIDEOS:第 ${runIndex} 次生成：\n${compatibility.message}`);
    }

    const outputFileName =
      runTimes === 1 ? `output_${baseTimestamp}.mp4` : `output_${baseTimestamp}_${String(runIndex)}.mp4`;
    const outputPath = path.join(outputDir, outputFileName);

    const firstInfo = compatibility.videos_info[0]?.[1];
    if (!firstInfo) {
      throw new Error("无法获取目标分辨率");
    }

    const filter = buildConcatFilter(compatibility.videos_info, firstInfo.width, firstInfo.height);

    emitEvent(sender, "progress", `第 ${runIndex}/${runTimes} 次：正在拼接视频（统一重编码以保证同步）...`);

    const args: string[] = [];
    for (const video of videos) {
      args.push("-i", video);
    }
    args.push(
      "-filter_complex",
      filter,
      "-map",
      "[outv]",
      "-map",
      "[outa]",
      "-vsync",
      "vfr",
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "23",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-fflags",
      "+genpts",
      "-avoid_negative_ts",
      "make_zero",
      "-shortest",
      outputPath,
    );

    await runFfmpeg(args);
    outputPaths.push(outputPath);
  }

  emitEvent(sender, "progress", "完成！");

  if (outputPaths.length === 1) {
    return {
      message: `视频拼接完成！输出文件: ${outputPaths[0] as string}`,
      outputPaths,
    };
  }

  return {
    message: `视频拼接完成！共生成 ${String(outputPaths.length)} 个视频：\n${outputPaths.join("\n")}`,
    outputPaths,
  };
}

async function getVideoMetadataInternal(videoPath: string): Promise<VideoMetadata> {
  const { stdout } = await runFfprobe([
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-count_frames",
    "-show_entries",
    "stream=codec_name,width,height,r_frame_rate,avg_frame_rate,nb_read_frames,nb_frames",
    "-show_entries",
    "format=duration",
    "-of",
    "json",
    videoPath,
  ]);

  const json = JSON.parse(stdout) as {
    streams?: Array<Record<string, unknown>>;
    format?: Record<string, unknown>;
  };

  const stream = json.streams?.[0];
  if (!stream) {
    throw new Error("无法获取视频流信息");
  }

  const width = Number(stream.width ?? 0);
  const height = Number(stream.height ?? 0);
  const codec = String(stream.codec_name ?? "unknown");

  const avgFrameRate = String(stream.avg_frame_rate ?? "N/A");
  const rFrameRate = String(stream.r_frame_rate ?? "N/A");
  const fpsFromProbe = parseRational(avgFrameRate) ?? parseRational(rFrameRate) ?? 0;

  const durationFromFormat = Number(json.format?.duration ?? 0);
  const duration = Number.isFinite(durationFromFormat) ? durationFromFormat : 0;

  const readFrames = Number(stream.nb_read_frames ?? Number.NaN);
  const nbFrames = Number(stream.nb_frames ?? Number.NaN);
  let totalFrames = 0;

  if (Number.isFinite(readFrames) && readFrames > 0) {
    totalFrames = Math.round(readFrames);
  } else if (Number.isFinite(nbFrames) && nbFrames > 0) {
    totalFrames = Math.round(nbFrames);
  } else if (fpsFromProbe > 0 && duration > 0) {
    totalFrames = Math.round(duration * fpsFromProbe);
  }

  const fps = fpsFromProbe > 0 ? fpsFromProbe : duration > 0 && totalFrames > 0 ? totalFrames / duration : 0;

  return {
    width,
    height,
    fps,
    duration,
    total_frames: totalFrames,
    codec,
  };
}

async function probeFrameTimestamps(videoPath: string, field: string): Promise<number[]> {
  const { stdout } = await runFfprobe([
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_frames",
    "-show_entries",
    `frame=${field}`,
    "-of",
    "csv=p=0",
    videoPath,
  ]);

  const timestamps: number[] = [];
  const lines = stdout.split(/\r?\n/);

  for (const line of lines) {
    const value = line.split(",")[0]?.trim();
    if (!value || value === "N/A") {
      continue;
    }
    const ts = Number(value);
    if (Number.isFinite(ts)) {
      timestamps.push(ts);
    }
  }

  if (timestamps.length === 0) {
    return [];
  }

  return normalizeTimestamps(timestamps);
}

async function getVideoFrameTimestamps(videoPath: string): Promise<number[]> {
  const candidates = ["best_effort_timestamp_time", "pkt_pts_time", "pkt_dts_time"];

  for (const field of candidates) {
    const timestamps = await probeFrameTimestamps(videoPath, field);
    if (timestamps.length > 0) {
      return timestamps;
    }
  }

  throw new Error("无法获取帧时间戳");
}

async function listFrameFiles(dirPath: string): Promise<string[]> {
  const entries = await fsp.readdir(dirPath, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".jpg"))
    .map((entry) => path.join(dirPath, entry.name));

  files.sort();
  return files;
}

async function extractAllFramesInternal(
  sender: WebContents | null,
  videoPath: string,
  emitProgress: boolean,
): Promise<{ metadata: VideoMetadata; frames: FrameInfo[]; tempDir: string }> {
  const metadata = await getVideoMetadataInternal(videoPath);

  const videoHash = calculateHash(videoPath);
  const tempDir = path.join(
    os.tmpdir(),
    `mp4handler_${videoHash}`,
    "frames",
    `${Date.now()}_${Math.random().toString(16).slice(2, 10)}`,
  );
  await ensureDir(tempDir);
  try {
    if (emitProgress && sender) {
      emitEvent(sender, "frame_progress", {
        message: "正在提取视频帧...",
        percent: 0,
      });
    }

    const outputPattern = path.join(tempDir, "frame_%05d.jpg");
    await runFfmpeg(["-i", videoPath, "-vf", "scale=320:-1", "-vsync", "0", "-q:v", "3", "-y", outputPattern]);

    const frameFiles = await listFrameFiles(tempDir);
    const frameTimestamps = await getVideoFrameTimestamps(videoPath);
    const limit = Math.min(frameFiles.length, frameTimestamps.length);
    const frames: FrameInfo[] = [];

    for (let idx = 0; idx < limit; idx++) {
      const frameNumber = idx;
      const timestamp = frameTimestamps[idx] ?? frameNumber / Math.max(metadata.fps, 1);
      frames.push({
        frame_number: frameNumber,
        timestamp,
        image_path: frameFiles[idx] as string,
      });

      if (emitProgress && sender && (idx % 30 === 0 || idx === limit - 1)) {
        const percent = limit > 0 ? Math.floor(((idx + 1) / limit) * 100) : 100;
        emitEvent(sender, "frame_progress", {
          message: `已提取 ${String(idx + 1)}/${String(limit)} 帧`,
          percent,
        });
      }
    }

    return { metadata, frames, tempDir };
  } catch (error) {
    await cleanupPathQuietly(tempDir);
    throw error;
  }
}

async function generateVideoSegmentsInternal(
  sender: WebContents,
  videoPath: string,
  segments: SegmentRange[],
  outputDir: string,
): Promise<string> {
  const metadata = await getVideoMetadataInternal(videoPath);

  const videoName = path.parse(videoPath).name;
  const outputBaseDir = path.join(outputDir, videoName);
  await ensureDir(outputBaseDir);

  const frameTimestamps = await getVideoFrameTimestamps(videoPath);
  const totalFrames = frameTimestamps.length;

  for (let idx = 0; idx < segments.length; idx++) {
    const segment = segments[idx] as SegmentRange;
    const segmentNum = idx + 1;
    const outputFile = path.join(outputBaseDir, `${videoName}_${String(segmentNum)}.mp4`);

    const startIdx = segment.start_frame;
    const endIdx = segment.end_frame;

    if (startIdx < 0 || endIdx < 0 || startIdx >= totalFrames || endIdx >= totalFrames || startIdx > endIdx) {
      throw new Error(`片段 ${String(segmentNum)} 的帧范围无效`);
    }

    const startTime = frameTimestamps[startIdx] as number;
    const endTimeExclusive =
      endIdx + 1 < totalFrames
        ? (frameTimestamps[endIdx + 1] as number)
        : Math.max(metadata.duration, frameTimestamps[endIdx] as number);
    const duration = Math.max(endTimeExclusive - startTime, 0);

    emitEvent(sender, "segment_progress", {
      current: segmentNum,
      total: segments.length,
      segmentName: `${videoName}_${String(segmentNum)}.mp4`,
      percent: Math.floor((segmentNum / segments.length) * 100),
    });

    await runFfmpeg([
      "-i",
      videoPath,
      "-ss",
      String(startTime),
      "-t",
      String(duration),
      "-vf",
      "setpts=PTS-STARTPTS",
      "-vsync",
      "vfr",
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "18",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-af",
      "aresample=async=1:first_pts=0,asetpts=PTS-STARTPTS",
      "-fflags",
      "+genpts",
      "-avoid_negative_ts",
      "make_zero",
      "-y",
      outputFile,
    ]);
  }

  return `成功生成 ${String(segments.length)} 个视频片段到: ${outputBaseDir}`;
}

type SimilarityAlgorithm = "histogram" | "ssim" | "frame_diff";

interface GrayImage {
  width: number;
  height: number;
  data: Uint8Array;
}

async function loadGrayImage(imagePath: string, cache: Map<string, GrayImage>): Promise<GrayImage> {
  const cached = cache.get(imagePath);
  if (cached) {
    return cached;
  }

  const fileBuffer = await fsp.readFile(imagePath);
  const decoded = jpeg.decode(fileBuffer, { useTArray: true });
  if (!decoded.width || !decoded.height || !decoded.data) {
    throw new Error("图片解码失败");
  }

  const gray = new Uint8Array(decoded.width * decoded.height);
  for (let i = 0; i < decoded.data.length; i += 4) {
    const r = decoded.data[i] as number;
    const g = decoded.data[i + 1] as number;
    const b = decoded.data[i + 2] as number;
    gray[Math.floor(i / 4)] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }

  const image: GrayImage = {
    width: decoded.width,
    height: decoded.height,
    data: gray,
  };

  cache.set(imagePath, image);
  return image;
}

function assertSameSize(img1: GrayImage, img2: GrayImage): void {
  if (img1.width !== img2.width || img1.height !== img2.height) {
    throw new Error("图片尺寸不匹配");
  }
}

function histogramSimilarity(img1: GrayImage, img2: GrayImage): number {
  assertSameSize(img1, img2);

  const hist1 = new Uint32Array(256);
  const hist2 = new Uint32Array(256);

  for (const v of img1.data) {
    const idx = Number(v);
    hist1[idx] = (hist1[idx] ?? 0) + 1;
  }
  for (const v of img2.data) {
    const idx = Number(v);
    hist2[idx] = (hist2[idx] ?? 0) + 1;
  }

  const total = img1.width * img1.height;
  let coeff = 0;
  for (let i = 0; i < 256; i++) {
    coeff += Math.sqrt((hist1[i] as number / total) * (hist2[i] as number / total));
  }

  return coeff;
}

function ssimSimilarity(img1: GrayImage, img2: GrayImage): number {
  assertSameSize(img1, img2);

  const totalPixels = img1.width * img1.height;
  let sum1 = 0;
  let sum2 = 0;

  for (let i = 0; i < totalPixels; i++) {
    sum1 += img1.data[i] as number;
    sum2 += img2.data[i] as number;
  }

  const mean1 = sum1 / totalPixels;
  const mean2 = sum2 / totalPixels;

  let var1 = 0;
  let var2 = 0;
  let covar = 0;

  for (let i = 0; i < totalPixels; i++) {
    const p1 = img1.data[i] as number;
    const p2 = img2.data[i] as number;
    const d1 = p1 - mean1;
    const d2 = p2 - mean2;
    var1 += d1 * d1;
    var2 += d2 * d2;
    covar += d1 * d2;
  }

  var1 /= totalPixels;
  var2 /= totalPixels;
  covar /= totalPixels;

  const k1 = 0.01;
  const k2 = 0.03;
  const l = 255;
  const c1 = (k1 * l) ** 2;
  const c2 = (k2 * l) ** 2;

  const numerator = (2 * mean1 * mean2 + c1) * (2 * covar + c2);
  const denominator = (mean1 * mean1 + mean2 * mean2 + c1) * (var1 + var2 + c2);
  const ssim = numerator / denominator;

  return (ssim + 1) / 2;
}

function frameDiffSimilarity(img1: GrayImage, img2: GrayImage): number {
  assertSameSize(img1, img2);

  const totalPixels = img1.width * img1.height;
  let totalDiff = 0;

  for (let i = 0; i < totalPixels; i++) {
    totalDiff += Math.abs((img1.data[i] as number) - (img2.data[i] as number));
  }

  const avgDiff = totalDiff / (totalPixels * 255);
  return 1 - avgDiff;
}

async function calculateSimilarity(
  img1Path: string,
  img2Path: string,
  algorithm: SimilarityAlgorithm,
  cache: Map<string, GrayImage>,
): Promise<number> {
  const img1 = await loadGrayImage(img1Path, cache);
  const img2 = await loadGrayImage(img2Path, cache);

  if (algorithm === "histogram") {
    return histogramSimilarity(img1, img2);
  }
  if (algorithm === "ssim") {
    return ssimSimilarity(img1, img2);
  }
  return frameDiffSimilarity(img1, img2);
}

function parseAlgorithm(value: string): SimilarityAlgorithm {
  if (value === "histogram" || value === "ssim" || value === "frame_diff") {
    return value;
  }
  throw new Error(`未知的算法: ${value}`);
}

async function autoSplitVideoInternal(
  sender: WebContents,
  params: {
    videoPath: string;
    outputDir: string;
    algorithm: string;
    threshold: number;
    minDuration: number;
    skipFirst: boolean;
    skipLast: boolean;
  },
): Promise<string> {
  const algorithm = parseAlgorithm(params.algorithm);
  const metadata = await getVideoMetadataInternal(params.videoPath);

  emitEvent(sender, "auto_split_progress", {
    message: "正在提取视频帧...",
    percent: 0,
  });

  const { frames, tempDir } = await extractAllFramesInternal(null, params.videoPath, false);
  try {
    if (frames.length < 2) {
      throw new Error("视频帧数不足");
    }

    const minFrames = Math.round(params.minDuration * metadata.fps);

    emitEvent(sender, "auto_split_progress", {
      message: "正在分析帧相似度...",
      percent: 10,
    });

    const splitPoints: number[] = [0];
    let lastSplitFrame = 0;
    const cache = new Map<string, GrayImage>();
    const totalFrames = frames.length;

    for (let i = 1; i < frames.length; i++) {
      const prevFrame = frames[i - 1] as FrameInfo;
      const currFrame = frames[i] as FrameInfo;

      let similarity = 1;
      try {
        similarity = await calculateSimilarity(prevFrame.image_path, currFrame.image_path, algorithm, cache);
      } catch {
        similarity = 1;
      }

      if (similarity < params.threshold) {
        const framesSinceLast = currFrame.frame_number - lastSplitFrame;
        if (framesSinceLast >= minFrames) {
          splitPoints.push(currFrame.frame_number);
          lastSplitFrame = currFrame.frame_number;
        }
      }

      const current = i - 1;
      if (current % 100 === 0) {
        const percent = 10 + Math.floor((current / totalFrames) * 60);
        emitEvent(sender, "auto_split_progress", {
          message: `已分析 ${String(current)}/${String(totalFrames)} 帧`,
          percent,
        });
      }
    }

    emitEvent(sender, "auto_split_progress", {
      message: `已分析 ${String(totalFrames)}/${String(totalFrames)} 帧`,
      percent: 70,
    });

    if (splitPoints[splitPoints.length - 1] !== frames.length - 1) {
      splitPoints.push(frames.length - 1);
    }

    let segments: SegmentRange[] = [];
    for (let i = 0; i < splitPoints.length - 1; i++) {
      segments.push({
        start_frame: splitPoints[i] as number,
        end_frame: (splitPoints[i + 1] as number) - 1,
      });
    }

    if (segments.length === 0) {
      throw new Error("未检测到场景切换，无法拆分");
    }

    const originalCount = segments.length;
    if (params.skipFirst && segments.length > 1) {
      segments = segments.slice(1);
    }
    if (params.skipLast && segments.length > 1) {
      segments = segments.slice(0, -1);
    }

    if (segments.length === 0) {
      throw new Error(
        `过滤后无片段可输出（原始片段数: ${String(originalCount)}，掐头: ${String(params.skipFirst)}，去尾: ${String(params.skipLast)}）`,
      );
    }

    emitEvent(sender, "auto_split_progress", {
      message: `识别到 ${String(originalCount)} 个片段，过滤后输出 ${String(segments.length)} 个`,
      percent: 70,
    });

    emitEvent(sender, "auto_split_progress", {
      message: "正在生成视频片段...",
      percent: 70,
    });

    const result = await generateVideoSegmentsInternal(sender, params.videoPath, segments, params.outputDir);

    emitEvent(sender, "auto_split_progress", {
      message: "完成",
      percent: 100,
    });

    return result;
  } finally {
    await cleanupPathQuietly(tempDir);
  }
}

async function removeEndingAndConcatInternal(
  sender: WebContents,
  params: {
    videoPath: string;
    outputDir: string;
    algorithm: string;
    threshold: number;
    minDuration: number;
    newEndingVideo: string | null;
    shuffleSegments: boolean;
  },
): Promise<string> {
  const algorithm = parseAlgorithm(params.algorithm);
  const metadata = await getVideoMetadataInternal(params.videoPath);

  emitEvent(sender, "remove_ending_progress", {
    message: "正在提取视频帧...",
    percent: 0,
  });

  const { frames, tempDir: frameTempDir } = await extractAllFramesInternal(null, params.videoPath, false);
  try {
    if (frames.length < 2) {
      throw new Error("视频帧数不足");
    }

    emitEvent(sender, "remove_ending_progress", {
      message: "帧提取完成",
      percent: 10,
    });

    const minFrames = Math.round(params.minDuration * metadata.fps);
    emitEvent(sender, "remove_ending_progress", {
      message: "正在分析帧相似度...",
      percent: 10,
    });

    const splitPoints: number[] = [0];
    let lastSplitFrame = 0;
    const cache = new Map<string, GrayImage>();
    const totalFrames = frames.length;

    for (let i = 1; i < frames.length; i++) {
      const prevFrame = frames[i - 1] as FrameInfo;
      const currFrame = frames[i] as FrameInfo;

      let similarity = 1;
      try {
        similarity = await calculateSimilarity(prevFrame.image_path, currFrame.image_path, algorithm, cache);
      } catch {
        similarity = 1;
      }

      if (similarity < params.threshold) {
        const framesSinceLast = currFrame.frame_number - lastSplitFrame;
        if (framesSinceLast >= minFrames) {
          splitPoints.push(currFrame.frame_number);
          lastSplitFrame = currFrame.frame_number;
        }
      }

      const current = i - 1;
      if (current % 100 === 0) {
        const percent = 10 + Math.floor((current / totalFrames) * 50);
        emitEvent(sender, "remove_ending_progress", {
          message: `已分析 ${String(current)}/${String(totalFrames)} 帧`,
          percent,
        });
      }
    }

    emitEvent(sender, "remove_ending_progress", {
      message: `已分析 ${String(totalFrames)}/${String(totalFrames)} 帧`,
      percent: 60,
    });

    if (splitPoints[splitPoints.length - 1] !== frames.length - 1) {
      splitPoints.push(frames.length - 1);
    }

    const segments: SegmentRange[] = [];
    for (let i = 0; i < splitPoints.length - 1; i++) {
      segments.push({
        start_frame: splitPoints[i] as number,
        end_frame: (splitPoints[i + 1] as number) - 1,
      });
    }

    const originalCount = segments.length;
    if (segments.length === 0) {
      throw new Error("未检测到场景切换（相似度始终高于阈值）");
    }

    segments.pop();

    if (segments.length === 0) {
      throw new Error(`检测到 ${String(originalCount)} 个片段，移除最后一个后无剩余片段，跳过该视频`);
    }

    emitEvent(sender, "remove_ending_progress", {
      message: `识别到 ${String(originalCount)} 个片段，移除最后一个后剩余 ${String(segments.length)} 个`,
      percent: 60,
    });

    if (params.shuffleSegments) {
      shuffleArray(segments);
    }

    emitEvent(sender, "remove_ending_progress", {
      message: "正在生成临时片段...",
      percent: 60,
    });

    const videoHash = calculateHash(params.videoPath);
    const segmentTempDir = path.join(
      os.tmpdir(),
      `mp4handler_${videoHash}`,
      "segments",
      `${Date.now()}_${Math.random().toString(16).slice(2, 10)}`,
    );
    await ensureDir(segmentTempDir);

    try {
      const frameTimestamps = await getVideoFrameTimestamps(params.videoPath);
      const totalFrameCount = frameTimestamps.length;
      const tempSegmentPaths: string[] = [];

      for (let idx = 0; idx < segments.length; idx++) {
        const segment = segments[idx] as SegmentRange;
        const segmentNum = idx + 1;
        const tempFile = path.join(segmentTempDir, `segment_${String(segmentNum)}.mp4`);

        const startIdx = segment.start_frame;
        const endIdx = segment.end_frame;
        if (startIdx < 0 || endIdx < 0 || startIdx >= totalFrameCount || endIdx >= totalFrameCount || startIdx > endIdx) {
          throw new Error(`片段 ${String(segmentNum)} 的帧范围无效`);
        }

        const startTime = frameTimestamps[startIdx] as number;
        const endTimeExclusive =
          endIdx + 1 < totalFrameCount
            ? (frameTimestamps[endIdx + 1] as number)
            : Math.max(metadata.duration, frameTimestamps[endIdx] as number);
        const duration = Math.max(endTimeExclusive - startTime, 0);

        const percent = 60 + Math.floor((segmentNum / segments.length) * 20);
        emitEvent(sender, "remove_ending_progress", {
          message: `正在生成临时片段 ${String(segmentNum)}/${String(segments.length)}`,
          percent,
        });

        await runFfmpeg([
          "-i",
          params.videoPath,
          "-ss",
          String(startTime),
          "-t",
          String(duration),
          "-vf",
          "setpts=PTS-STARTPTS",
          "-vsync",
          "vfr",
          "-c:v",
          "libx264",
          "-preset",
          "fast",
          "-crf",
          "18",
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          "-af",
          "aresample=async=1:first_pts=0,asetpts=PTS-STARTPTS",
          "-fflags",
          "+genpts",
          "-avoid_negative_ts",
          "make_zero",
          "-y",
          tempFile,
        ]);

        tempSegmentPaths.push(tempFile);
      }

      if (params.newEndingVideo) {
        if (!(await fileExists(params.newEndingVideo))) {
          throw new Error(`新结尾视频不存在: ${params.newEndingVideo}`);
        }
        tempSegmentPaths.push(params.newEndingVideo);
      }

      emitEvent(sender, "remove_ending_progress", {
        message: "正在检测视频兼容性...",
        percent: 80,
      });

      const videosInfo = await checkVideoCompatibilityForPaths(tempSegmentPaths);
      const firstInfo = videosInfo[0]?.[1];
      if (!firstInfo) {
        throw new Error("无法获取目标分辨率");
      }

      const filter = buildConcatFilter(videosInfo, firstInfo.width, firstInfo.height);

      const videoName = path.parse(params.videoPath).name;
      const outputPath = path.join(params.outputDir, `${videoName}_processed.mp4`);

      emitEvent(sender, "remove_ending_progress", {
        message: "正在合成视频...",
        percent: 80,
      });

      const args: string[] = [];
      for (const p of tempSegmentPaths) {
        args.push("-i", p);
      }
      args.push(
        "-filter_complex",
        filter,
        "-map",
        "[outv]",
        "-map",
        "[outa]",
        "-vsync",
        "vfr",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-fflags",
        "+genpts",
        "-avoid_negative_ts",
        "make_zero",
        "-shortest",
        outputPath,
      );

      await runFfmpeg(args);

      emitEvent(sender, "remove_ending_progress", {
        message: "完成",
        percent: 100,
      });

      return "";
    } finally {
      await cleanupPathQuietly(segmentTempDir);
    }
  } finally {
    await cleanupPathQuietly(frameTempDir);
  }
}

async function downloadSingleFile(sender: WebContents, url: string, outputDir: string): Promise<string> {
  emitEvent(sender, "download_progress", {
    url,
    progress: 0,
    speed: "0 MB/s",
    status: "downloading",
  } satisfies DownloadProgress);

  const filename = extractFilename(url);
  const outputPath = path.join(outputDir, filename);

  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    emitEvent(sender, "download_progress", {
      url,
      progress: 0,
      speed: "0 MB/s",
      status: "failed",
    } satisfies DownloadProgress);
    throw new Error(`请求失败: ${String(error)}`);
  }

  if (!response.ok || !response.body) {
    emitEvent(sender, "download_progress", {
      url,
      progress: 0,
      speed: "0 MB/s",
      status: "failed",
    } satisfies DownloadProgress);
    throw new Error(`HTTP 错误: ${String(response.status)}`);
  }

  const totalSize = Number(response.headers.get("content-length") ?? 0);
  let downloaded = 0;
  const start = Date.now();

  await ensureDir(outputDir);
  const writer = fs.createWriteStream(outputPath);
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      downloaded += chunk.length;

      if (!writer.write(chunk)) {
        await new Promise<void>((resolve) => {
          writer.once("drain", () => resolve());
        });
      }

      if (downloaded % (1024 * 1024) < chunk.length) {
        const progress = totalSize > 0 ? Math.floor((downloaded / totalSize) * 100) : 0;
        const elapsed = (Date.now() - start) / 1000;
        const speed = elapsed > 0 ? `${((downloaded / 1024 / 1024) / elapsed).toFixed(2)} MB/s` : "0 MB/s";

        emitEvent(sender, "download_progress", {
          url,
          progress,
          speed,
          status: "downloading",
        } satisfies DownloadProgress);
      }
    }

    await new Promise<void>((resolve, reject) => {
      writer.end(() => resolve());
      writer.once("error", reject);
    });
  } catch (error) {
    writer.destroy();
    await cleanupPathQuietly(outputPath);
    throw error;
  }

  emitEvent(sender, "download_progress", {
    url,
    progress: 100,
    speed: "0 MB/s",
    status: "completed",
  } satisfies DownloadProgress);

  return outputPath;
}

function extractFilename(url: string): string {
  try {
    const urlObj = new URL(url);
    const name = path.basename(urlObj.pathname);
    return name || "download.mp4";
  } catch {
    const fallback = url.split("/").pop()?.split("?")[0];
    return fallback && fallback.length > 0 ? fallback : "download.mp4";
  }
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<{ success: number; failed: number }> {
  let current = 0;
  let success = 0;
  let failed = 0;

  const workers = Array.from({ length: Math.max(1, limit) }).map(async () => {
    while (true) {
      const index = current;
      current += 1;

      if (index >= items.length) {
        break;
      }

      try {
        await worker(items[index] as T);
        success += 1;
      } catch {
        failed += 1;
      }
    }
  });

  await Promise.all(workers);
  return { success, failed };
}

const TASK_LOG_LIMIT = 500;
const taskSubscribers = new Set<WebContents>();
const taskExecutionLocks = new Set<string>();
const taskLogQueues = new Map<string, Promise<void>>();
const removedTaskIds = new Set<string>();

function toIsoNow(): string {
  return new Date().toISOString();
}

function normalizeWorkflowName(name: string): string {
  return name.trim().toLowerCase();
}

function workflowToMeta(workflow: WorkflowDefinition): WorkflowMeta {
  return {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    source: workflow.source,
    readonly: workflow.readonly,
    updatedAt: workflow.updatedAt,
    systemKind: workflow.systemKind,
  };
}

function registerTaskSubscriber(sender: WebContents): void {
  if (sender.isDestroyed()) {
    return;
  }
  taskSubscribers.add(sender);
}

function emitTaskBroadcast(event: string, payload: unknown): void {
  for (const sender of Array.from(taskSubscribers)) {
    if (sender.isDestroyed()) {
      taskSubscribers.delete(sender);
      continue;
    }
    sender.send("mp4handler:event", { event, payload });
  }
}

function tryFindTask(taskId: string): WorkflowTaskRecord | null {
  return getTasksFromStore().find((item) => item.id === taskId) ?? null;
}

function isTaskRemoved(taskId: string): boolean {
  return removedTaskIds.has(taskId) || !tryFindTask(taskId);
}

function findTask(taskId: string): WorkflowTaskRecord {
  const task = tryFindTask(taskId);
  if (!task) {
    throw new Error("任务不存在");
  }
  return task;
}

function removeTaskFromStore(taskId: string): WorkflowTaskRecord | null {
  const tasks = getTasksFromStore();
  const index = tasks.findIndex((item) => item.id === taskId);
  if (index < 0) {
    return null;
  }
  const removed = tasks[index] as WorkflowTaskRecord;
  tasks.splice(index, 1);
  setTasksToStore(tasks);
  emitTaskBroadcast("task:removed", { taskId });
  return removed;
}

async function waitTaskLogQueue(taskId: string): Promise<void> {
  const pending = taskLogQueues.get(taskId);
  if (!pending) {
    return;
  }
  await pending.catch(() => undefined);
}

function updateTask(taskId: string, patch: Partial<WorkflowTaskRecord>): WorkflowTaskRecord {
  const tasks = getTasksFromStore();
  const index = tasks.findIndex((item) => item.id === taskId);
  if (index < 0) {
    throw new Error("任务不存在");
  }
  const updated: WorkflowTaskRecord = {
    ...(tasks[index] as WorkflowTaskRecord),
    ...patch,
    updatedAt: toIsoNow(),
  };
  tasks[index] = updated;
  setTasksToStore(tasks);
  emitTaskBroadcast("task:update", updated);
  return updated;
}

async function appendTaskLog(taskId: string, message: string, level: "info" | "error" | "warn" = "info"): Promise<void> {
  if (isTaskRemoved(taskId)) {
    return;
  }

  const prev = taskLogQueues.get(taskId) ?? Promise.resolve();
  const next = prev
    .catch(() => undefined)
    .then(async () => {
      if (isTaskRemoved(taskId)) {
        return;
      }
      const runtime = await readTaskRuntime(taskId);
      runtime.logs.push({
        timestamp: toIsoNow(),
        level,
        message,
      });
      if (runtime.logs.length > TASK_LOG_LIMIT) {
        runtime.logs = runtime.logs.slice(runtime.logs.length - TASK_LOG_LIMIT);
      }
      await writeTaskRuntime(taskId, runtime);
      if (!isTaskRemoved(taskId)) {
        emitTaskBroadcast("task:log", {
          taskId,
          entry: runtime.logs[runtime.logs.length - 1],
        });
      }
    });
  taskLogQueues.set(taskId, next);
  try {
    await next;
  } finally {
    if (taskLogQueues.get(taskId) === next) {
      taskLogQueues.delete(taskId);
    }
  }
}

function createSystemWorkflowDefinitions(): WorkflowDefinition[] {
  const now = toIsoNow();
  return [
    {
      id: "system-batch-download",
      name: "批量下载",
      description: "用户输入 URL 文本 -> 拆分数组 -> 批量下载",
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
            label: "用户输入(URL文本)",
            inputs: [],
            outputs: ["text"],
            config: {
              text: "",
            },
            position: { x: 80, y: 90 },
          },
          {
            id: "text_to_array",
            type: "text_split",
            label: "文本拆数组",
            inputs: ["text"],
            outputs: ["items"],
            config: {
              mode: "newline",
              trim: true,
              removeEmpty: true,
            },
            position: { x: 380, y: 90 },
          },
          {
            id: "output_dir",
            type: "output_dir",
            label: "选择输出目录",
            inputs: [],
            outputs: ["outputDir"],
            config: {},
            position: { x: 380, y: 260 },
          },
          {
            id: "batch_download",
            type: "network",
            label: "批量下载",
            inputs: ["urls", "outputDir"],
            outputs: ["files", "done"],
            config: {
              action: "batch_download",
              maxConcurrent: 3,
              asyncDownload: true,
            },
            position: { x: 700, y: 90 },
          },
        ],
        edges: [
          { id: "e1", source: "user_urls", target: "text_to_array", sourceHandle: "out-0", targetHandle: "in-0" },
          { id: "e2", source: "text_to_array", target: "batch_download", sourceHandle: "out-0", targetHandle: "in-0" },
          { id: "e3", source: "output_dir", target: "batch_download", sourceHandle: "out-0", targetHandle: "in-1" },
        ],
      },
    },
    {
      id: "system-video-concat",
      name: "视频拼接",
      description: "输入目录 -> 读取目录 -> 随机拼接（支持固定开头/固定结尾）",
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
            label: "输入目录",
            inputs: [],
            outputs: ["dir"],
            config: {},
            position: { x: 80, y: 90 },
          },
          {
            id: "read_dir",
            type: "file",
            label: "读取目录",
            inputs: ["dir"],
            outputs: ["files", "count"],
            config: {
              action: "read_mp4",
              recursive: true,
              maxDepth: 2,
            },
            position: { x: 360, y: 90 },
          },
          {
            id: "fixed_start",
            type: "select_video",
            label: "固定开头(可选)",
            inputs: [],
            outputs: ["videoPath"],
            config: {
              videoPath: "",
            },
            position: { x: 360, y: 260 },
          },
          {
            id: "fixed_end",
            type: "select_video",
            label: "固定结尾(可选)",
            inputs: [],
            outputs: ["videoPath"],
            config: {
              videoPath: "",
            },
            position: { x: 360, y: 430 },
          },
          {
            id: "output_dir",
            type: "output_dir",
            label: "拼接输出目录",
            inputs: [],
            outputs: ["outputDir"],
            config: {},
            position: { x: 660, y: 430 },
          },
          {
            id: "random_concat",
            type: "random_concat",
            label: "随机拼接",
            inputs: ["files", "startVideo", "endVideo", "outputDir"],
            outputs: ["files", "result"],
            config: {
              randomCountMin: 2,
              randomCountMax: 4,
              runTimes: 1,
            },
            position: { x: 980, y: 200 },
          },
        ],
        edges: [
          { id: "e1", source: "input_dir", target: "read_dir", sourceHandle: "out-0", targetHandle: "in-0" },
          { id: "e2", source: "read_dir", target: "random_concat", sourceHandle: "out-0", targetHandle: "in-0" },
          { id: "e3", source: "fixed_start", target: "random_concat", sourceHandle: "out-0", targetHandle: "in-1" },
          { id: "e4", source: "fixed_end", target: "random_concat", sourceHandle: "out-0", targetHandle: "in-2" },
          { id: "e5", source: "output_dir", target: "random_concat", sourceHandle: "out-0", targetHandle: "in-3" },
        ],
      },
    },
    {
      id: "system-remove-ending",
      name: "去结尾",
      description: "输入目录 -> 读取目录 -> 去结尾（拆解参数可复用）",
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
            label: "输入目录",
            inputs: [],
            outputs: ["dir"],
            config: {},
            position: { x: 80, y: 90 },
          },
          {
            id: "read_dir",
            type: "file",
            label: "读取目录",
            inputs: ["dir"],
            outputs: ["files", "count"],
            config: {
              action: "read_mp4",
              recursive: false,
              maxDepth: 0,
            },
            position: { x: 360, y: 90 },
          },
          {
            id: "split_profile",
            type: "video",
            label: "视频拆解参数",
            inputs: ["files", "outputDir", "splitConfig"],
            outputs: ["result", "splitConfig"],
            config: {
              action: "split_profile",
              algorithm: "ssim",
              threshold: 0.7,
              minDuration: 2,
              skipFirst: false,
              skipLast: true,
            },
            position: { x: 360, y: 260 },
          },
          {
            id: "new_ending",
            type: "select_video",
            label: "新结尾视频(可选)",
            inputs: [],
            outputs: ["videoPath"],
            config: {
              videoPath: "",
            },
            position: { x: 360, y: 430 },
          },
          {
            id: "output_dir",
            type: "output_dir",
            label: "处理输出目录",
            inputs: [],
            outputs: ["outputDir"],
            config: {},
            position: { x: 660, y: 430 },
          },
          {
            id: "remove_ending",
            type: "remove_ending",
            label: "去结尾",
            inputs: ["files", "splitConfig", "outputDir", "newEndingVideo"],
            outputs: ["files", "result"],
            config: {
              shuffleSegments: false,
            },
            position: { x: 980, y: 200 },
          },
        ],
        edges: [
          { id: "e1", source: "input_dir", target: "read_dir", sourceHandle: "out-0", targetHandle: "in-0" },
          { id: "e2", source: "read_dir", target: "remove_ending", sourceHandle: "out-0", targetHandle: "in-0" },
          { id: "e3", source: "split_profile", target: "remove_ending", sourceHandle: "out-1", targetHandle: "in-1" },
          { id: "e4", source: "output_dir", target: "remove_ending", sourceHandle: "out-0", targetHandle: "in-2" },
          { id: "e5", source: "new_ending", target: "remove_ending", sourceHandle: "out-0", targetHandle: "in-3" },
        ],
      },
    },
    {
      id: "system-auto-split",
      name: "自动拆解",
      description: "输入目录 -> 读取目录 -> 视频拆解参数 -> 自动拆解",
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
            label: "输入目录",
            inputs: [],
            outputs: ["dir"],
            config: {},
            position: { x: 80, y: 90 },
          },
          {
            id: "read_dir",
            type: "file",
            label: "读取目录",
            inputs: ["dir"],
            outputs: ["files", "count"],
            config: {
              action: "read_mp4",
              recursive: true,
              maxDepth: 2,
            },
            position: { x: 360, y: 90 },
          },
          {
            id: "output_dir",
            type: "output_dir",
            label: "拆解输出目录",
            inputs: [],
            outputs: ["outputDir"],
            config: {},
            position: { x: 360, y: 260 },
          },
          {
            id: "split_profile",
            type: "video",
            label: "视频拆解参数",
            inputs: ["files", "outputDir", "splitConfig"],
            outputs: ["result", "splitConfig"],
            config: {
              action: "split_profile",
              algorithm: "ssim",
              threshold: 0.7,
              minDuration: 2,
              skipFirst: false,
              skipLast: true,
            },
            position: { x: 700, y: 260 },
          },
          {
            id: "video_split",
            type: "video",
            label: "视频拆解",
            inputs: ["files", "outputDir", "splitConfig"],
            outputs: ["result", "splitConfig"],
            config: {
              action: "auto_split",
            },
            position: { x: 700, y: 90 },
          },
        ],
        edges: [
          { id: "e1", source: "input_dir", target: "read_dir", sourceHandle: "out-0", targetHandle: "in-0" },
          { id: "e2", source: "read_dir", target: "video_split", sourceHandle: "out-0", targetHandle: "in-0" },
          { id: "e3", source: "output_dir", target: "video_split", sourceHandle: "out-0", targetHandle: "in-1" },
          { id: "e4", source: "split_profile", target: "video_split", sourceHandle: "out-1", targetHandle: "in-2" },
        ],
      },
    },
    {
      id: "system-auto-split-concat",
      name: "自动拆解并拼接",
      description: "输入目录 -> 自动拆解 -> 将拆解片段随机拼接（支持固定开头/固定结尾）",
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
            label: "输入目录",
            inputs: [],
            outputs: ["dir"],
            config: {},
            position: { x: 80, y: 90 },
          },
          {
            id: "read_dir",
            type: "file",
            label: "读取目录",
            inputs: ["dir"],
            outputs: ["files", "count"],
            config: {
              action: "read_mp4",
              recursive: true,
              maxDepth: 2,
            },
            position: { x: 340, y: 90 },
          },
          {
            id: "split_output_dir",
            type: "output_dir",
            label: "拆解输出目录",
            inputs: [],
            outputs: ["outputDir"],
            config: {},
            position: { x: 340, y: 260 },
          },
          {
            id: "split_profile",
            type: "video",
            label: "视频拆解参数",
            inputs: ["files", "outputDir", "splitConfig"],
            outputs: ["result", "splitConfig"],
            config: {
              action: "split_profile",
              algorithm: "ssim",
              threshold: 0.7,
              minDuration: 2,
              skipFirst: false,
              skipLast: true,
            },
            position: { x: 620, y: 260 },
          },
          {
            id: "video_split",
            type: "video",
            label: "自动拆解",
            inputs: ["files", "outputDir", "splitConfig"],
            outputs: ["result", "splitConfig"],
            config: {
              action: "auto_split",
            },
            position: { x: 620, y: 90 },
          },
          {
            id: "fixed_start",
            type: "select_video",
            label: "固定开头(可选)",
            inputs: [],
            outputs: ["videoPath"],
            config: {
              videoPath: "",
            },
            position: { x: 900, y: 260 },
          },
          {
            id: "fixed_end",
            type: "select_video",
            label: "固定结尾(可选)",
            inputs: [],
            outputs: ["videoPath"],
            config: {
              videoPath: "",
            },
            position: { x: 900, y: 430 },
          },
          {
            id: "concat_output_dir",
            type: "output_dir",
            label: "拼接输出目录",
            inputs: [],
            outputs: ["outputDir"],
            config: {},
            position: { x: 1180, y: 430 },
          },
          {
            id: "random_concat",
            type: "random_concat",
            label: "随机拼接",
            inputs: ["files", "startVideo", "endVideo", "outputDir"],
            outputs: ["files", "result"],
            config: {
              randomCountMin: 2,
              randomCountMax: 4,
              runTimes: 1,
            },
            position: { x: 1460, y: 200 },
          },
        ],
        edges: [
          { id: "e1", source: "input_dir", target: "read_dir", sourceHandle: "out-0", targetHandle: "in-0" },
          { id: "e2", source: "read_dir", target: "video_split", sourceHandle: "out-0", targetHandle: "in-0" },
          { id: "e3", source: "split_output_dir", target: "video_split", sourceHandle: "out-0", targetHandle: "in-1" },
          { id: "e4", source: "split_profile", target: "video_split", sourceHandle: "out-1", targetHandle: "in-2" },
          { id: "e5", source: "video_split", target: "random_concat", sourceHandle: "out-2", targetHandle: "in-0" },
          { id: "e6", source: "fixed_start", target: "random_concat", sourceHandle: "out-0", targetHandle: "in-1" },
          { id: "e7", source: "fixed_end", target: "random_concat", sourceHandle: "out-0", targetHandle: "in-2" },
          { id: "e8", source: "concat_output_dir", target: "random_concat", sourceHandle: "out-0", targetHandle: "in-3" },
        ],
      },
    },
    {
      id: "system-download-auto-split",
      name: "下载并自动拆解",
      description: "输入 URL 文本后自动下载，再自动拆解下载结果",
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
            label: "用户输入(URL文本)",
            inputs: [],
            outputs: ["text"],
            config: {
              text: "",
            },
            position: { x: 80, y: 90 },
          },
          {
            id: "text_to_array",
            type: "text_split",
            label: "文本拆数组",
            inputs: ["text"],
            outputs: ["items"],
            config: {
              mode: "newline",
              trim: true,
              removeEmpty: true,
            },
            position: { x: 360, y: 90 },
          },
          {
            id: "download_output_dir",
            type: "output_dir",
            label: "下载输出目录",
            inputs: [],
            outputs: ["outputDir"],
            config: {},
            position: { x: 360, y: 260 },
          },
          {
            id: "batch_download",
            type: "network",
            label: "批量下载",
            inputs: ["urls", "outputDir"],
            outputs: ["files", "done"],
            config: {
              action: "batch_download",
              maxConcurrent: 3,
              asyncDownload: true,
            },
            position: { x: 660, y: 90 },
          },
          {
            id: "split_output_dir",
            type: "output_dir",
            label: "拆解输出目录",
            inputs: [],
            outputs: ["outputDir"],
            config: {},
            position: { x: 660, y: 260 },
          },
          {
            id: "split_profile",
            type: "video",
            label: "视频拆解参数",
            inputs: ["files", "outputDir", "splitConfig"],
            outputs: ["result", "splitConfig"],
            config: {
              action: "split_profile",
              algorithm: "ssim",
              threshold: 0.7,
              minDuration: 2,
              skipFirst: false,
              skipLast: true,
            },
            position: { x: 980, y: 260 },
          },
          {
            id: "video_split",
            type: "video",
            label: "视频拆解",
            inputs: ["files", "outputDir", "splitConfig"],
            outputs: ["result", "splitConfig"],
            config: {
              action: "auto_split",
            },
            position: { x: 980, y: 90 },
          },
        ],
        edges: [
          { id: "e1", source: "user_urls", target: "text_to_array", sourceHandle: "out-0", targetHandle: "in-0" },
          { id: "e2", source: "text_to_array", target: "batch_download", sourceHandle: "out-0", targetHandle: "in-0" },
          { id: "e3", source: "download_output_dir", target: "batch_download", sourceHandle: "out-0", targetHandle: "in-1" },
          { id: "e4", source: "batch_download", target: "video_split", sourceHandle: "out-0", targetHandle: "in-0" },
          { id: "e5", source: "split_output_dir", target: "video_split", sourceHandle: "out-0", targetHandle: "in-1" },
          { id: "e6", source: "split_profile", target: "video_split", sourceHandle: "out-1", targetHandle: "in-2" },
        ],
      },
    },
  ];
}

function findSystemWorkflowDefinition(workflowId: string): WorkflowDefinition | undefined {
  return createSystemWorkflowDefinitions().find((item) => item.id === workflowId);
}

function ensureDefaultWorkflows(): void {
  const systemDefinitions = createSystemWorkflowDefinitions();
  const byId = new Map(getWorkflowsFromStore().map((item) => [item.id, item] as const));
  let changed = false;
  const systemIdSet = new Set(systemDefinitions.map((item) => item.id));

  for (const systemWorkflow of systemDefinitions) {
    const existing = byId.get(systemWorkflow.id);
    if (!existing) {
      byId.set(systemWorkflow.id, systemWorkflow);
      changed = true;
      continue;
    }

    let normalized = existing;
    if (
      existing.source !== "system" ||
      existing.readonly !== false ||
      existing.schemaVersion !== WORKFLOW_SCHEMA_VERSION ||
      existing.systemKind !== systemWorkflow.systemKind
    ) {
      normalized = {
        ...existing,
        source: "system",
        readonly: false,
        schemaVersion: WORKFLOW_SCHEMA_VERSION,
        systemKind: systemWorkflow.systemKind,
      };
    }

    if (normalized !== existing) {
      byId.set(systemWorkflow.id, normalized);
      changed = true;
    }
  }

  for (const [workflowId, workflow] of Array.from(byId.entries())) {
    if (workflow.source === "system" && !systemIdSet.has(workflowId)) {
      byId.delete(workflowId);
      changed = true;
    }
  }

  if (changed) {
    const merged = Array.from(byId.values());
    setWorkflowsToStore(merged);
  }
}

function assertWorkflowNameUnique(name: string, ignoreWorkflowId?: string): void {
  const normalized = normalizeWorkflowName(name);
  const duplicated = getWorkflowsFromStore().find(
    (item) => normalizeWorkflowName(item.name) === normalized && item.id !== ignoreWorkflowId,
  );
  if (duplicated) {
    throw new Error("工作流名称重复，请使用其他名称");
  }
}

function getWorkflowById(workflowId: string): WorkflowDefinition {
  ensureDefaultWorkflows();
  const workflow = getWorkflowsFromStore().find((item) => item.id === workflowId);
  if (!workflow) {
    throw new Error("工作流不存在");
  }
  return workflow;
}

function createTaskSender(taskId: string): WebContents {
  return {
    send: (_channel: string, message: unknown) => {
      const data = message as { event?: string; payload?: unknown } | undefined;
      if (!data?.event) {
        return;
      }
      const payloadText =
        typeof data.payload === "string"
          ? data.payload
          : typeof data.payload === "object"
            ? JSON.stringify(data.payload)
            : String(data.payload);
      void appendTaskLog(taskId, `[${data.event}] ${payloadText}`);
      emitTaskBroadcast("task:progress", {
        taskId,
        event: data.event,
        payload: data.payload,
      });
    },
  } as unknown as WebContents;
}

async function setWaitingInteraction(taskId: string, interaction: InteractionRequest): Promise<void> {
  if (isTaskRemoved(taskId)) {
    return;
  }
  const runtime = await readTaskRuntime(taskId);
  runtime.interaction = interaction;
  await writeTaskRuntime(taskId, runtime);
  if (isTaskRemoved(taskId)) {
    return;
  }
  updateTask(taskId, {
    status: "waiting_input",
    waitingInteraction: interaction,
    currentNodeId: interaction.nodeId,
  });
}

async function clearWaitingInteraction(taskId: string): Promise<void> {
  if (isTaskRemoved(taskId)) {
    return;
  }
  const runtime = await readTaskRuntime(taskId);
  runtime.interaction = null;
  await writeTaskRuntime(taskId, runtime);
  if (isTaskRemoved(taskId)) {
    return;
  }
  updateTask(taskId, {
    waitingInteraction: null,
  });
}

function parseSegmentsFromPayload(payload: Record<string, unknown>): SegmentRange[] {
  if (Array.isArray(payload.segments)) {
    return asSegments(payload.segments);
  }
  const raw = asString(payload.segmentsJson || payload.segments_json);
  if (!raw) {
    return [];
  }
  const parsed = JSON.parse(raw) as unknown;
  return asSegments(parsed);
}

function getNodeExecutionDeps(): NodeExecutionDeps {
  return {
    ensureDir,
    collectVideos,
    listMp4Files,
    runWithConcurrency,
    downloadSingleFile,
    concatVideosInternal,
    autoSplitVideoInternal,
    removeEndingAndConcatInternal,
    generateVideoSegmentsInternal,
    appendTaskLog,
    parseSegmentsFromPayload,
  };
}

async function executeCustomGraphWorkflow(
  task: WorkflowTaskRecord,
  workflow: WorkflowDefinition,
  resumePayload?: Record<string, unknown>,
): Promise<void> {
  await executeWorkflowGraph(
    task,
    workflow,
    {
      readTaskRuntime,
      writeTaskRuntime,
      updateTask,
      appendTaskLog,
      setWaitingInteraction,
      clearWaitingInteraction,
      createTaskSender,
      nodeExecutionDeps: getNodeExecutionDeps(),
    },
    resumePayload,
  );
}

async function executeConcatWorkflow(task: WorkflowTaskRecord): Promise<void> {
  const sender = createTaskSender(task.id);
  const runtimeInput = task.runtimeInput;
  const outputDir = asString(runtimeInput.outputDir) || task.runDir;
  await ensureDir(outputDir);

  await appendTaskLog(task.id, "开始执行视频拼接");
  const concatParams = {
    inputDir: asString(runtimeInput.inputDir),
    startingVideo: runtimeInput.startingVideo ? asString(runtimeInput.startingVideo) : null,
    endingVideo: runtimeInput.endingVideo ? asString(runtimeInput.endingVideo) : null,
    randomCountMin: Math.max(1, Math.round(asNumber(runtimeInput.randomCountMin) || 2)),
    randomCountMax: Math.max(1, Math.round(asNumber(runtimeInput.randomCountMax) || 4)),
    maxDepth: Math.max(0, Math.round(asNumber(runtimeInput.maxDepth) || 2)),
    runTimes: Math.max(1, Math.round(asNumber(runtimeInput.runTimes) || 1)),
    outputDir,
    ...(Array.isArray(runtimeInput.files) ? { files: runtimeInput.files.map((item) => String(item)) } : {}),
  };
  const result = await concatVideosInternal(sender, concatParams);
  await appendTaskLog(task.id, result.message);
}

async function executeAutoSplitWorkflow(task: WorkflowTaskRecord): Promise<void> {
  const sender = createTaskSender(task.id);
  const runtimeInput = task.runtimeInput;
  const files = await listMp4Files(asString(runtimeInput.inputDir));
  const outputDir = asString(runtimeInput.outputDir) || task.runDir;
  await ensureDir(outputDir);

  for (const videoPath of files) {
    await appendTaskLog(task.id, `开始自动拆解: ${videoPath}`);
    await autoSplitVideoInternal(sender, {
      videoPath,
      outputDir,
      algorithm: asString(runtimeInput.algorithm) || "ssim",
      threshold: asNumber(runtimeInput.threshold) || 0.7,
      minDuration: asNumber(runtimeInput.minDuration) || 2,
      skipFirst: asBoolean(runtimeInput.skipFirst),
      skipLast: runtimeInput.skipLast === undefined ? true : asBoolean(runtimeInput.skipLast),
    });
  }
}

async function executeRemoveEndingWorkflow(task: WorkflowTaskRecord): Promise<void> {
  const sender = createTaskSender(task.id);
  const runtimeInput = task.runtimeInput;
  const files = await listMp4Files(asString(runtimeInput.inputDir));
  const outputDir = asString(runtimeInput.outputDir) || task.runDir;
  await ensureDir(outputDir);

  for (const videoPath of files) {
    await appendTaskLog(task.id, `开始去结尾处理: ${videoPath}`);
    await removeEndingAndConcatInternal(sender, {
      videoPath,
      outputDir,
      algorithm: asString(runtimeInput.algorithm) || "ssim",
      threshold: asNumber(runtimeInput.threshold) || 0.7,
      minDuration: asNumber(runtimeInput.minDuration) || 2,
      newEndingVideo: runtimeInput.newEndingVideo ? asString(runtimeInput.newEndingVideo) : null,
      shuffleSegments: asBoolean(runtimeInput.shuffleSegments),
    });
  }
}

async function executeBatchDownloadWorkflow(task: WorkflowTaskRecord): Promise<void> {
  const sender = createTaskSender(task.id);
  const runtimeInput = task.runtimeInput;
  const outputDir = asString(runtimeInput.outputDir) || task.runDir;
  await ensureDir(outputDir);
  const urls = Array.isArray(runtimeInput.urls)
    ? runtimeInput.urls.map((item) => String(item)).filter(Boolean)
    : asString(runtimeInput.urlsText)
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean);

  const maxConcurrent = Math.max(1, Math.round(asNumber(runtimeInput.maxConcurrent) || 3));
  const { success, failed } = await runWithConcurrency(urls, maxConcurrent, async (url) => {
    await downloadSingleFile(sender, url, outputDir);
  });
  await appendTaskLog(task.id, `下载完成，成功 ${String(success)}，失败 ${String(failed)}`);
}

async function ensureSingleSplitWaiting(task: WorkflowTaskRecord): Promise<void> {
  const runtime = await readTaskRuntime(task.id);
  const videoPath = asString(task.runtimeInput.videoPath);
  const outputDir = asString(task.runtimeInput.outputDir) || path.dirname(videoPath);
  if (!videoPath) {
    throw new Error("运行参数缺少 videoPath");
  }

  runtime.phase = "await_single_segments";
  runtime.context = {
    videoPath,
    outputDir,
  };
  await writeTaskRuntime(task.id, runtime);

  const interaction: InteractionRequest = {
    taskId: task.id,
    nodeId: "human_select_segments",
    title: "请填写拆解片段",
    description: "请输入 JSON 格式片段数组，例如 [{\"start_frame\":0,\"end_frame\":100}]",
    formSchema: [
      {
        id: "segmentsJson",
        label: "片段 JSON",
        type: "textarea",
        required: true,
        placeholder: "[{\"start_frame\":0,\"end_frame\":100}]",
      },
    ],
    context: {
      videoPath,
      outputDir,
    },
  };

  await setWaitingInteraction(task.id, interaction);
  await appendTaskLog(task.id, "任务进入人工处理：等待片段选择");
}

async function resumeSingleSplit(task: WorkflowTaskRecord, payload: Record<string, unknown>): Promise<void> {
  const runtime = await readTaskRuntime(task.id);
  const videoPath = asString(runtime.context.videoPath);
  const outputDir = asString(runtime.context.outputDir) || path.dirname(videoPath);
  if (!videoPath) {
    throw new Error("任务上下文缺少 videoPath");
  }
  const segments = parseSegmentsFromPayload(payload);
  if (segments.length === 0) {
    throw new Error("segments 不能为空");
  }

  await clearWaitingInteraction(task.id);
  await appendTaskLog(task.id, `收到人工片段配置，共 ${String(segments.length)} 段`);
  await generateVideoSegmentsInternal(createTaskSender(task.id), videoPath, segments, outputDir);
}

async function ensureBatchSplitWaiting(task: WorkflowTaskRecord): Promise<void> {
  const runtime = await readTaskRuntime(task.id);
  if (!runtime.phase) {
    const inputDir = asString(task.runtimeInput.inputDir);
    const outputDir = asString(task.runtimeInput.outputDir) || task.runDir;
    if (!inputDir) {
      throw new Error("运行参数缺少 inputDir");
    }
    const files = await listMp4Files(inputDir);
    runtime.phase = "await_batch_segments";
    runtime.context = {
      files,
      index: 0,
      outputDir,
    };
    await appendTaskLog(task.id, `批量拆解待处理视频数: ${String(files.length)}`);
  }

  const files = Array.isArray(runtime.context.files)
    ? runtime.context.files.map((item) => String(item))
    : [];
  const index = Number(runtime.context.index ?? 0);
  if (index >= files.length) {
    runtime.phase = "done";
    runtime.interaction = null;
    await writeTaskRuntime(task.id, runtime);
    return;
  }

  const currentVideo = files[index] as string;
  runtime.interaction = {
    taskId: task.id,
    nodeId: "human_batch_segments",
    title: `请处理视频 ${String(index + 1)}/${String(files.length)}`,
    description: "可选择生成、跳过或稍后处理",
    formSchema: [
      {
        id: "action",
        label: "操作",
        type: "select",
        required: true,
        defaultValue: "generate",
        options: [
          { label: "生成片段", value: "generate" },
          { label: "跳过", value: "skip" },
          { label: "稍后处理", value: "postpone" },
        ],
      },
      {
        id: "segmentsJson",
        label: "片段 JSON",
        type: "textarea",
        placeholder: "[{\"start_frame\":0,\"end_frame\":100}]",
      },
      {
        id: "deleteOriginal",
        label: "生成后删除原文件",
        type: "boolean",
        defaultValue: false,
      },
    ],
    context: {
      videoPath: currentVideo,
      index,
      total: files.length,
    },
  };

  await writeTaskRuntime(task.id, runtime);
  await setWaitingInteraction(task.id, runtime.interaction);
  await appendTaskLog(task.id, `等待人工处理视频: ${currentVideo}`);
}

async function resumeBatchSplit(task: WorkflowTaskRecord, payload: Record<string, unknown>): Promise<void> {
  const runtime = await readTaskRuntime(task.id);
  const files = Array.isArray(runtime.context.files)
    ? runtime.context.files.map((item) => String(item))
    : [];
  let index = Number(runtime.context.index ?? 0);
  const outputDir = asString(runtime.context.outputDir) || task.runDir;
  if (index >= files.length) {
    return;
  }

  const currentVideo = files[index] as string;
  const action = asString(payload.action) || "generate";

  if (action === "postpone") {
    files.splice(index, 1);
    files.push(currentVideo);
    await appendTaskLog(task.id, `稍后处理: ${currentVideo}`);
  } else if (action === "skip") {
    index += 1;
    await appendTaskLog(task.id, `已跳过: ${currentVideo}`);
  } else {
    const segments = parseSegmentsFromPayload(payload);
    if (segments.length === 0) {
      throw new Error("生成片段模式下必须提供 segmentsJson");
    }
    await appendTaskLog(task.id, `开始生成片段: ${currentVideo}`);
    await generateVideoSegmentsInternal(createTaskSender(task.id), currentVideo, segments, outputDir);
    if (asBoolean(payload.deleteOriginal)) {
      await fsp.rm(currentVideo).catch(() => void 0);
      await appendTaskLog(task.id, `已删除原文件: ${currentVideo}`);
    }
    index += 1;
  }

  runtime.context.files = files;
  runtime.context.index = index;
  runtime.interaction = null;
  await writeTaskRuntime(task.id, runtime);
  await clearWaitingInteraction(task.id);

  if (index < files.length) {
    await ensureBatchSplitWaiting(task);
  }
}

async function executeTask(taskId: string, resumePayload?: Record<string, unknown>): Promise<void> {
  if (taskExecutionLocks.has(taskId)) {
    return;
  }
  taskExecutionLocks.add(taskId);
  try {
    if (isTaskRemoved(taskId)) {
      return;
    }

    const task = tryFindTask(taskId);
    if (!task) {
      return;
    }

    const workflow = task.workflowSnapshot
      ? ({
          id: task.workflowSnapshot.id,
          name: task.workflowSnapshot.name,
          description: "",
          source: task.workflowSnapshot.source,
          readonly: false,
          schemaVersion: WORKFLOW_SCHEMA_VERSION,
          systemKind: task.workflowSnapshot.systemKind,
          graph: task.workflowSnapshot.graph,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
        } satisfies WorkflowDefinition)
      : getWorkflowById(task.workflowId);
    let executedByGraph = false;

    if (task.status === "canceled") {
      return;
    }

    if (isTaskRemoved(taskId)) {
      return;
    }

    updateTask(taskId, {
      status: "running",
      startedAt: task.startedAt ?? toIsoNow(),
      error: undefined,
    });

    const shouldUseGraphExecution =
      workflow.graph.nodes.length > 0 && (workflow.systemKind === "custom" || workflow.source === "system");

    const taskForExecution = tryFindTask(taskId);
    if (!taskForExecution) {
      return;
    }

    if (shouldUseGraphExecution) {
      executedByGraph = true;
      await executeCustomGraphWorkflow(taskForExecution, workflow, resumePayload);
    } else if (workflow.systemKind === "concat") {
      await executeConcatWorkflow(taskForExecution);
    } else if (workflow.systemKind === "auto_split") {
      await executeAutoSplitWorkflow(taskForExecution);
    } else if (workflow.systemKind === "remove_ending") {
      await executeRemoveEndingWorkflow(taskForExecution);
    } else if (workflow.systemKind === "batch_download") {
      await executeBatchDownloadWorkflow(taskForExecution);
    } else if (workflow.systemKind === "single_split") {
      if (resumePayload) {
        await resumeSingleSplit(taskForExecution, resumePayload);
      } else {
        await ensureSingleSplitWaiting(taskForExecution);
      }
    } else if (workflow.systemKind === "batch_split") {
      if (resumePayload) {
        await resumeBatchSplit(taskForExecution, resumePayload);
      } else {
        await ensureBatchSplitWaiting(taskForExecution);
      }
    } else {
      await executeCustomGraphWorkflow(taskForExecution, workflow, resumePayload);
    }

    const after = tryFindTask(taskId);
    if (!after) {
      return;
    }
    if (after.status === "waiting_input" || after.status === "canceled") {
      return;
    }

    const runtime = await readTaskRuntime(taskId);
    const shouldComplete =
      runtime.phase === "done" ||
      runtime.phase === "graph_done" ||
      (!executedByGraph &&
        (workflow.systemKind === "concat" ||
          workflow.systemKind === "auto_split" ||
          workflow.systemKind === "remove_ending" ||
          workflow.systemKind === "batch_download" ||
          workflow.systemKind === "single_split"));
    if (shouldComplete) {
      updateTask(taskId, {
        status: "completed",
        finishedAt: toIsoNow(),
        currentNodeId: "completed",
        waitingInteraction: null,
      });
      await appendTaskLog(taskId, "任务执行完成");
    }
  } catch (error) {
    if (isTaskRemoved(taskId)) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    if (tryFindTask(taskId)) {
      updateTask(taskId, {
        status: "failed",
        finishedAt: toIsoNow(),
        error: message,
      });
      await appendTaskLog(taskId, message, "error");
    }
  } finally {
    taskExecutionLocks.delete(taskId);
  }
}

function createEmptyGraph(): WorkflowGraph {
  return {
    nodes: [],
    edges: [],
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function createRunDir(workflowName: string): string {
  const safeName = workflowName.replace(/[^\w\u4e00-\u9fa5-]+/g, "_");
  return path.join(app.getPath("userData"), "taskRuns", `${safeName}_${Date.now()}`);
}

function asString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string") {
        return item;
      }
    }
  }
  return "";
}

function asNumber(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function asBoolean(value: unknown): boolean {
  return Boolean(value);
}

function asSegments(value: unknown): SegmentRange[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      const segment = item as Partial<SegmentRange>;
      return {
        start_frame: Number(segment.start_frame ?? -1),
        end_frame: Number(segment.end_frame ?? -1),
      };
    })
    .filter((segment) => Number.isFinite(segment.start_frame) && Number.isFinite(segment.end_frame));
}

async function listMp4Files(dirPath: string): Promise<string[]> {
  const stat = await fsp.stat(dirPath).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new Error("路径不是一个目录");
  }

  const entries = await fsp.readdir(dirPath, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".mp4"))
    .map((entry) => path.join(dirPath, entry.name));

  files.sort();
  return files;
}

export async function invokeMp4Command(
  sender: WebContents,
  command: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  registerTaskSubscriber(sender);

  const deprecatedCommands = new Set([
    "concat_videos",
    "concat_videos_with_reencode",
    "get_video_metadata",
    "extract_all_frames",
    "generate_video_segments",
    "list_mp4_files",
    "load_batch_progress",
    "save_batch_progress",
    "delete_video_file",
    "auto_split_video",
    "remove_ending_and_concat",
    "batch_download",
  ]);
  if (deprecatedCommands.has(command)) {
    throw new Error("旧命令入口已下线，请使用 workflow:* 与 task:* 接口");
  }

  switch (command) {
    case "workflow:list": {
      ensureDefaultWorkflows();
      return getWorkflowsFromStore()
        .map(workflowToMeta)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }

    case "workflow:get": {
      const workflowId = asString(args.id);
      const workflow = getWorkflowById(workflowId);
      return {
        ...workflow,
        graph: normalizeWorkflowGraph(workflow.graph),
      };
    }

    case "workflow:validate": {
      const graph = normalizeWorkflowGraph(args.graph);
      const issues = validateWorkflowGraphStructure(graph);
      return {
        valid: issues.length === 0,
        issues,
      };
    }

    case "workflow:create": {
      ensureDefaultWorkflows();
      const name = asString(args.name).trim();
      if (!name) {
        throw new Error("工作流名称不能为空");
      }
      assertWorkflowNameUnique(name);

      const now = toIsoNow();
      const created: WorkflowDefinition = {
        id: crypto.randomUUID(),
        name,
        description: asString(args.description),
        source: "user",
        readonly: false,
        schemaVersion: WORKFLOW_SCHEMA_VERSION,
        systemKind: "custom",
        graph: normalizeWorkflowGraph(args.graph) || createEmptyGraph(),
        createdAt: now,
        updatedAt: now,
      };
      const workflows = getWorkflowsFromStore();
      workflows.push(created);
      setWorkflowsToStore(workflows);
      return created;
    }

    case "workflow:update": {
      ensureDefaultWorkflows();
      const workflowId = asString(args.id);
      const workflows = getWorkflowsFromStore();
      const index = workflows.findIndex((item) => item.id === workflowId);
      if (index < 0) {
        throw new Error("工作流不存在");
      }
      const target = workflows[index] as WorkflowDefinition;
      const nextName = asString(args.name).trim();
      if (!nextName) {
        throw new Error("工作流名称不能为空");
      }
      assertWorkflowNameUnique(nextName, workflowId);

      const updated: WorkflowDefinition = {
        ...target,
        name: nextName,
        description: asString(args.description),
        graph: normalizeWorkflowGraph(args.graph),
        systemKind: target.source === "system" ? target.systemKind : "custom",
        updatedAt: toIsoNow(),
      };
      workflows[index] = updated;
      setWorkflowsToStore(workflows);
      return updated;
    }

    case "workflow:delete": {
      ensureDefaultWorkflows();
      const workflowId = asString(args.id);
      const workflows = getWorkflowsFromStore();
      const target = workflows.find((item) => item.id === workflowId);
      if (!target) {
        throw new Error("工作流不存在");
      }
      if (target.source === "system") {
        throw new Error("内置工作流不可删除");
      }
      const filtered = workflows.filter((item) => item.id !== workflowId);
      setWorkflowsToStore(filtered);
      return null;
    }

    case "workflow:restore-default": {
      ensureDefaultWorkflows();
      const workflowId = asString(args.id);
      const defaultDefinition = findSystemWorkflowDefinition(workflowId);
      if (!defaultDefinition) {
        throw new Error("仅支持还原内置工作流");
      }

      const workflows = getWorkflowsFromStore();
      const index = workflows.findIndex((item) => item.id === workflowId);
      const existing = index >= 0 ? (workflows[index] as WorkflowDefinition) : null;

      const restored: WorkflowDefinition = {
        ...defaultDefinition,
        createdAt: existing?.createdAt || defaultDefinition.createdAt,
        updatedAt: toIsoNow(),
      };

      if (index >= 0) {
        workflows[index] = restored;
      } else {
        workflows.push(restored);
      }
      setWorkflowsToStore(workflows);
      return restored;
    }

    case "workflow:restore-all-default": {
      ensureDefaultWorkflows();
      const now = toIsoNow();
      const systemDefinitions = createSystemWorkflowDefinitions();
      const workflowMap = new Map(getWorkflowsFromStore().map((item) => [item.id, item] as const));
      const restoredIds: string[] = [];

      for (const systemWorkflow of systemDefinitions) {
        const existing = workflowMap.get(systemWorkflow.id);
        const restored: WorkflowDefinition = {
          ...systemWorkflow,
          createdAt: existing?.createdAt || systemWorkflow.createdAt,
          updatedAt: now,
        };
        workflowMap.set(systemWorkflow.id, restored);
        restoredIds.push(systemWorkflow.id);
      }

      setWorkflowsToStore(Array.from(workflowMap.values()));
      return {
        restoredIds,
        count: restoredIds.length,
      };
    }

    case "workflow:duplicate": {
      ensureDefaultWorkflows();
      const workflowId = asString(args.id);
      const sourceWorkflow = getWorkflowById(workflowId);
      let nextName = asString(args.newName).trim();
      if (!nextName) {
        nextName = `${sourceWorkflow.name} 副本`;
      }
      if (getWorkflowsFromStore().some((item) => normalizeWorkflowName(item.name) === normalizeWorkflowName(nextName))) {
        let seq = 2;
        let candidate = `${nextName} ${String(seq)}`;
        while (getWorkflowsFromStore().some((item) => normalizeWorkflowName(item.name) === normalizeWorkflowName(candidate))) {
          seq += 1;
          candidate = `${nextName} ${String(seq)}`;
        }
        nextName = candidate;
      }
      assertWorkflowNameUnique(nextName);
      const now = toIsoNow();
      const duplicated: WorkflowDefinition = {
        ...sourceWorkflow,
        id: crypto.randomUUID(),
        name: nextName,
        source: "user",
        readonly: false,
        systemKind: "custom",
        createdAt: now,
        updatedAt: now,
      };
      const workflows = getWorkflowsFromStore();
      workflows.push(duplicated);
      setWorkflowsToStore(workflows);
      return duplicated;
    }

    case "workflow:run": {
      ensureDefaultWorkflows();
      const workflowId = asString(args.id);
      const workflow = getWorkflowById(workflowId);
      const runtimeInput = asRecord(args.runtimeInput);
      const graphOverride = args.graph !== undefined ? normalizeWorkflowGraph(args.graph) : null;
      const runtimeWorkflow: WorkflowDefinition = graphOverride
        ? {
            ...workflow,
            graph: graphOverride,
          }
        : {
            ...workflow,
            graph: normalizeWorkflowGraph(workflow.graph),
          };

      const issues = validateWorkflowRunConfig(runtimeWorkflow, runtimeInput);
      if (issues.length > 0) {
        throw new Error(`运行前检查失败:\n${issues.map((item) => `- ${item}`).join("\n")}`);
      }
      const taskId = crypto.randomUUID();
      removedTaskIds.delete(taskId);
      const runDir = createRunDir(runtimeWorkflow.name);
      await ensureDir(runDir);

      const task: WorkflowTaskRecord = {
        id: taskId,
        workflowId: runtimeWorkflow.id,
        workflowName: runtimeWorkflow.name,
        status: "queued",
        currentNodeId: "queued",
        createdAt: toIsoNow(),
        updatedAt: toIsoNow(),
        runDir,
        runtimeInput,
        waitingInteraction: null,
        workflowSnapshot: {
          id: runtimeWorkflow.id,
          name: runtimeWorkflow.name,
          source: runtimeWorkflow.source,
          systemKind: runtimeWorkflow.systemKind,
          graph: runtimeWorkflow.graph,
        },
      };

      const tasks = getTasksFromStore();
      tasks.push(task);
      setTasksToStore(tasks);

      await writeTaskRuntime(taskId, {
        phase: "",
        context: {},
        logs: [],
        interaction: null,
      });
      await appendTaskLog(taskId, `任务已创建，工作流: ${runtimeWorkflow.name}`);
      emitTaskBroadcast("task:update", task);

      void executeTask(taskId);
      return task;
    }

    case "task:subscribe": {
      return null;
    }

    case "task:list": {
      ensureDefaultWorkflows();
      return getTasksFromStore().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    case "task:get": {
      const taskId = asString(args.id);
      const task = findTask(taskId);
      const runtime = await readTaskRuntime(taskId);
      return {
        task,
        logs: runtime.logs,
        interactionRequest: runtime.interaction,
      };
    }

    case "task:cancel": {
      const taskId = asString(args.id);
      const task = findTask(taskId);
      if (task.status === "completed" || task.status === "failed" || task.status === "canceled") {
        return task;
      }
      const updated = updateTask(taskId, {
        status: "canceled",
        finishedAt: toIsoNow(),
        waitingInteraction: null,
      });
      const runtime = await readTaskRuntime(taskId);
      runtime.interaction = null;
      await writeTaskRuntime(taskId, runtime);
      await appendTaskLog(taskId, "任务已取消", "warn");
      return updated;
    }

    case "task:resume": {
      const taskId = asString(args.id);
      const payload = asRecord(args.payload);
      const task = findTask(taskId);
      if (task.status !== "waiting_input") {
        throw new Error("任务当前不在等待人工输入状态");
      }
      updateTask(taskId, {
        status: "running",
      });
      void executeTask(taskId, payload);
      return findTask(taskId);
    }

    case "task:remove": {
      const taskId = asString(args.id);
      const existing = tryFindTask(taskId);
      if (!existing) {
        return {
          id: taskId,
          removed: false,
        };
      }
      removedTaskIds.add(taskId);
      removeTaskFromStore(taskId);
      await waitTaskLogQueue(taskId);
      taskLogQueues.delete(taskId);
      await deleteTaskRuntime(taskId);
      return {
        id: taskId,
        removed: true,
      };
    }

    case "task:clear-completed": {
      const tasks = getTasksFromStore();
      const completedIds = tasks.filter((item) => item.status === "completed").map((item) => item.id);
      if (completedIds.length === 0) {
        return { count: 0, ids: [] as string[] };
      }

      const remaining = tasks.filter((item) => item.status !== "completed");
      setTasksToStore(remaining);

      for (const taskId of completedIds) {
        removedTaskIds.add(taskId);
        await waitTaskLogQueue(taskId);
        taskLogQueues.delete(taskId);
        await deleteTaskRuntime(taskId);
        emitTaskBroadcast("task:removed", { taskId });
      }

      return {
        count: completedIds.length,
        ids: completedIds,
      };
    }

    case "concat_videos": {
      const concatParams = {
        inputDir: asString(args.inputDir),
        startingVideo: args.startingVideo ? asString(args.startingVideo) : null,
        endingVideo: args.endingVideo ? asString(args.endingVideo) : null,
        randomCountMin: Math.round(asNumber(args.randomCountMin)),
        randomCountMax: Math.round(asNumber(args.randomCountMax)),
        maxDepth: Math.round(asNumber(args.maxDepth)),
        runTimes: Math.round(asNumber(args.runTimes)),
        outputDir: asString(args.outputDir),
        ...(Array.isArray(args.files) ? { files: args.files.map((item) => String(item)) } : {}),
      };
      const result = await concatVideosInternal(sender, concatParams);
      return result.message;
    }

    case "concat_videos_with_reencode": {
      const concatParams = {
        inputDir: asString(args.inputDir),
        startingVideo: args.startingVideo ? asString(args.startingVideo) : null,
        endingVideo: args.endingVideo ? asString(args.endingVideo) : null,
        randomCountMin: Math.round(asNumber(args.randomCountMin)),
        randomCountMax: Math.round(asNumber(args.randomCountMax)),
        maxDepth: Math.round(asNumber(args.maxDepth)),
        runTimes: Math.round(asNumber(args.runTimes)),
        outputDir: asString(args.outputDir),
        ...(Array.isArray(args.files) ? { files: args.files.map((item) => String(item)) } : {}),
      };
      const result = await concatVideosInternal(sender, concatParams);
      return result.message;
    }

    case "get_video_metadata": {
      return getVideoMetadataInternal(asString(args.videoPath));
    }

    case "extract_all_frames": {
      const { frames } = await extractAllFramesInternal(sender, asString(args.videoPath), true);
      return frames;
    }

    case "generate_video_segments": {
      return generateVideoSegmentsInternal(
        sender,
        asString(args.videoPath),
        asSegments(args.segments),
        asString(args.outputDir),
      );
    }

    case "list_mp4_files": {
      return listMp4Files(asString(args.dirPath));
    }

    case "load_batch_progress": {
      const progressPath = asString(args.progressPath);
      if (!(await fileExists(progressPath))) {
        return null;
      }
      const content = await fsp.readFile(progressPath, "utf8");
      return JSON.parse(content) as BatchProgress;
    }

    case "save_batch_progress": {
      const progressPath = asString(args.progressPath);
      const progress = args.progress as BatchProgress;
      await fsp.writeFile(progressPath, JSON.stringify(progress, null, 2), "utf8");
      return null;
    }

    case "delete_video_file": {
      const filePath = asString(args.filePath);
      if (!(await fileExists(filePath))) {
        throw new Error("文件不存在");
      }
      await fsp.rm(filePath);
      return null;
    }

    case "auto_split_video": {
      return autoSplitVideoInternal(sender, {
        videoPath: asString(args.videoPath),
        outputDir: asString(args.outputDir),
        algorithm: asString(args.algorithm),
        threshold: asNumber(args.threshold),
        minDuration: asNumber(args.minDuration),
        skipFirst: asBoolean(args.skipFirst),
        skipLast: asBoolean(args.skipLast),
      });
    }

    case "remove_ending_and_concat": {
      return removeEndingAndConcatInternal(sender, {
        videoPath: asString(args.videoPath),
        outputDir: asString(args.outputDir),
        algorithm: asString(args.algorithm),
        threshold: asNumber(args.threshold),
        minDuration: asNumber(args.minDuration),
        newEndingVideo: args.newEndingVideo ? asString(args.newEndingVideo) : null,
        shuffleSegments: asBoolean(args.shuffleSegments),
      });
    }

    case "batch_download": {
      const urls = Array.isArray(args.urls) ? args.urls.map((url) => String(url)).filter(Boolean) : [];
      const outputDir = asString(args.outputDir);
      const maxConcurrent = Math.max(1, Math.round(asNumber(args.maxConcurrent) || 3));

      await ensureDir(outputDir);

      const { success, failed } = await runWithConcurrency(urls, maxConcurrent, async (url) => {
        await downloadSingleFile(sender, url, outputDir);
      });

      return `下载完成！成功: ${String(success)}, 失败: ${String(failed)}`;
    }

    default:
      throw new Error(`未知命令: ${command}`);
  }
}
