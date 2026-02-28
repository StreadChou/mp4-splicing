import { app, type WebContents } from "electron";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import jpeg from "jpeg-js";
import { clearAllTaskRuntime, deleteTaskRuntime, readTaskRuntime, writeTaskRuntime } from "./backend/infra/runtime/task-runtime-store";
import {
  getWorkflowSchemaVersion,
  getTasksFromStore,
  getWorkflowsFromStore,
  resetWorkflowStore,
  setWorkflowSchemaVersion,
  setTasksToStore,
  setWorkflowsToStore,
} from "./backend/infra/store/workflow-store";
import {
  type WorkflowDefinition,
  type WorkflowGraph,
  type WorkflowTaskRecord,
  type WorkflowTaskStatus,
  WORKFLOW_SCHEMA_VERSION,
} from "./backend/shared/types";
import type { NodeExecutionDeps } from "./backend/domain/graph/node-execution";
import { executeWorkflowGraph } from "./backend/domain/graph/graph-executor";
import { createSystemWorkflowDefinitions } from "./backend/domain/workflow/system-workflow-definitions";
import { createWorkflowService } from "./backend/domain/workflow/workflow-service";
import { invokeWorkflowTaskCommand } from "./backend/domain/command/workflow-task-command";
import { createTaskLifecycle } from "./backend/domain/task/task-lifecycle";

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
    shuffle?: boolean;
  },
): Promise<{ message: string; outputPaths: string[] }> {
  const { inputDir, files, startingVideo, endingVideo, randomCountMin, randomCountMax, maxDepth, runTimes, outputDir } = params;
  const shuffle = params.shuffle ?? true;

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

  if (shuffle) {
    videoPoolManager.getOrCreatePool(poolInputKey, poolDepth, allVideos);
  }

  const outputPaths: string[] = [];
  const baseTimestamp = formatNowStamp();

  for (let runIndex = 1; runIndex <= runTimes; runIndex++) {
    const desiredCount =
      randomCountMin === randomCountMax
        ? randomCountMin
        : randomCountMin + Math.floor(Math.random() * (randomCountMax - randomCountMin + 1));

    const actualCount = Math.min(desiredCount, availableCount);
    const videos = shuffle
      ? videoPoolManager.drawVideos(poolInputKey, poolDepth, actualCount)
      : allVideos.slice(0, actualCount);

    if (desiredCount > availableCount) {
      emitEvent(
        sender,
        "progress",
        `第 ${runIndex}/${runTimes} 次：请求 ${desiredCount} 个视频，但只找到 ${availableCount} 个，将使用全部 ${availableCount} 个视频`,
      );
    } else if (shuffle) {
      const remaining = videoPoolManager.getRemainingCount(poolInputKey, poolDepth);
      const msg =
        remaining + videos.length === availableCount
          ? `第 ${runIndex}/${runTimes} 次：池子已抽完，重新填充。本次选择 ${videos.length} 个视频`
          : `第 ${runIndex}/${runTimes} 次：已选择 ${videos.length} 个视频（池子剩余 ${remaining}）`;
      emitEvent(sender, "progress", msg);
    } else {
      emitEvent(sender, "progress", `第 ${runIndex}/${runTimes} 次：按原始顺序组合 ${videos.length} 个视频`);
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

function toIsoNow(): string {
  return new Date().toISOString();
}

const {
  registerTaskSubscriber,
  emitTaskBroadcast,
  tryFindTask,
  isTaskRemoved,
  findTask,
  removeTaskFromStore,
  waitTaskLogQueue,
  updateTask,
  appendTaskLog,
  createTaskSender,
  setWaitingInteraction,
  clearWaitingInteraction,
  removedTaskIds,
  taskLogQueues,
  taskExecutionLocks,
} = createTaskLifecycle({
  getTasksFromStore,
  setTasksToStore,
  readTaskRuntime,
  writeTaskRuntime,
  toIsoNow,
});

const {
  normalizeWorkflowName,
  workflowToMeta,
  findSystemWorkflowDefinition,
  ensureDefaultWorkflows,
  assertWorkflowNameUnique,
  getWorkflowById,
} = createWorkflowService({
  getWorkflowSchemaVersion,
  setWorkflowSchemaVersion,
  resetWorkflowStore,
  clearAllTaskRuntime,
  getWorkflowsFromStore,
  setWorkflowsToStore,
  createSystemWorkflowDefinitions,
  workflowSchemaVersion: WORKFLOW_SCHEMA_VERSION,
  removedTaskIds,
  taskLogQueues,
  taskExecutionLocks,
});

function getNodeExecutionDeps(): NodeExecutionDeps {
  return {
    ensureDir,
    collectVideos,
    listMp4Files,
    runWithConcurrency,
    downloadSingleFile,
    concatVideosInternal,
    autoSplitVideoInternal,
    appendTaskLog,
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

    const taskForExecution = tryFindTask(taskId);
    if (!taskForExecution) {
      return;
    }

    await executeCustomGraphWorkflow(taskForExecution, workflow, resumePayload);

    const after = tryFindTask(taskId);
    if (!after) {
      return;
    }
    if (after.status === "waiting_input" || after.status === "canceled") {
      return;
    }

    const runtime = await readTaskRuntime(taskId);
    const shouldComplete = runtime.phase === "done" || runtime.phase === "graph_done";
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

function createRunDir(workflowName: string): string {
  const safeName = workflowName.replace(/[^\w\u4e00-\u9fa5-]+/g, "_");
  return path.join(app.getPath("userData"), "taskRuns", `${safeName}_${Date.now()}`);
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

  return invokeWorkflowTaskCommand(command, args, {
    ensureDefaultWorkflows,
    workflowToMeta,
    getWorkflowById,
    findSystemWorkflowDefinition,
    createSystemWorkflowDefinitions,
    assertWorkflowNameUnique,
    normalizeWorkflowName,
    createEmptyGraph,
    createRunDir,
    toIsoNow,
    ensureDir,
    getWorkflowsFromStore,
    setWorkflowsToStore,
    getTasksFromStore,
    setTasksToStore,
    writeTaskRuntime,
    readTaskRuntime,
    deleteTaskRuntime,
    tryFindTask,
    findTask,
    removeTaskFromStore,
    waitTaskLogQueue,
    updateTask,
    appendTaskLog,
    emitTaskBroadcast,
    executeTask,
    removedTaskIds,
    taskLogQueues,
  });
}
