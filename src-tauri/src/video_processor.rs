use rand::seq::SliceRandom;
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::collections::HashMap;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::ShellExt;
use walkdir::WalkDir;

/// 视频池状态
#[derive(Debug, Clone)]
pub struct VideoPoolState {
    pub all_videos: Vec<PathBuf>,      // 完整视频列表
    pub remaining_videos: Vec<PathBuf>, // 剩余可用视频
}

/// 全局视频池管理器
pub struct VideoPoolManager {
    pools: Mutex<HashMap<String, VideoPoolState>>,
}

impl VideoPoolManager {
    pub fn new() -> Self {
        Self {
            pools: Mutex::new(HashMap::new()),
        }
    }

    /// 生成池子的唯一key（目录路径 + 递归深度）
    fn make_key(input_dir: &str, max_depth: usize) -> String {
        format!("{}::{}", input_dir, max_depth)
    }

    /// 获取或创建视频池
    pub fn get_or_create_pool(
        &self,
        input_dir: &str,
        max_depth: usize,
        all_videos: Vec<PathBuf>,
    ) -> VideoPoolState {
        let key = Self::make_key(input_dir, max_depth);
        let mut pools = self.pools.lock().unwrap();

        if let Some(pool) = pools.get(&key) {
            // 检查池子是否需要刷新（目录内容可能变化）
            if pool.all_videos.len() == all_videos.len() {
                return pool.clone();
            }
        }

        // 创建新池子
        let pool = VideoPoolState {
            all_videos: all_videos.clone(),
            remaining_videos: all_videos.clone(),
        };

        pools.insert(key, pool.clone());
        pool
    }

    /// 从池子中抽取视频（不放回）
    pub fn draw_videos(
        &self,
        input_dir: &str,
        max_depth: usize,
        count: usize,
    ) -> Result<Vec<PathBuf>, String> {
        let key = Self::make_key(input_dir, max_depth);
        let mut pools = self.pools.lock().unwrap();

        let pool = pools.get_mut(&key)
            .ok_or("视频池不存在，请先初始化")?;

        // 如果剩余视频不足，重新填充池子
        if pool.remaining_videos.is_empty() {
            pool.remaining_videos = pool.all_videos.clone();
        }

        // 随机打乱剩余视频
        let mut rng = rand::thread_rng();
        pool.remaining_videos.shuffle(&mut rng);

        // 抽取指定数量
        let actual_count = count.min(pool.remaining_videos.len());
        let selected: Vec<PathBuf> = pool.remaining_videos
            .drain(0..actual_count)
            .collect();

        Ok(selected)
    }

    /// 获取池子剩余视频数量
    pub fn get_remaining_count(&self, input_dir: &str, max_depth: usize) -> usize {
        let key = Self::make_key(input_dir, max_depth);
        let pools = self.pools.lock().unwrap();
        pools.get(&key).map(|p| p.remaining_videos.len()).unwrap_or(0)
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct VideoInfo {
    pub codec: String,
    pub width: u32,
    pub height: u32,
    pub fps: String,
    pub duration: f64,
    pub has_audio: bool,
}

#[derive(Debug, Serialize)]
pub struct CompatibilityResult {
    pub compatible: bool,
    pub message: String,
    pub videos_info: Vec<(String, VideoInfo)>,
}

/// 收集目录中的 MP4 视频（支持最大递归层数）
fn collect_videos(dir: &str, max_depth: usize) -> Result<Vec<PathBuf>, String> {
    let path = Path::new(dir);
    if !path.exists() {
        return Err(format!("目录不存在: {}", dir));
    }
    if !path.is_dir() {
        return Err(format!("路径不是目录: {}", dir));
    }

    let depth_limit = max_depth.saturating_add(1);
    let mut videos: Vec<PathBuf> = WalkDir::new(path)
        .max_depth(depth_limit)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path().is_file()
                && e.path()
                    .extension()
                    .and_then(|s| s.to_str())
                    .map(|s| s.eq_ignore_ascii_case("mp4"))
                    .unwrap_or(false)
        })
        .map(|e| e.path().to_path_buf())
        .collect();

    if videos.is_empty() {
        return Err(format!("在目录中未找到 MP4 文件: {}", dir));
    }
    videos.sort();
    Ok(videos)
}

/// 使用 FFprobe 检测视频信息
async fn get_video_info(app: &AppHandle, video_path: &Path) -> Result<VideoInfo, String> {
    let sidecar = app
        .shell()
        .sidecar("ffprobe")
        .map_err(|e| format!("FFprobe 启动失败: {}", e))?;

    let output = sidecar
        .args(&[
            "-v",
            "error",
            "-show_entries",
            "stream=codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate",
            "-show_entries",
            "format=duration",
            "-of",
            "json",
            video_path.to_str().unwrap(),
        ])
        .output()
        .await
        .map_err(|e| format!("FFprobe 执行失败: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "FFprobe 执行失败: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let json_str = String::from_utf8_lossy(&output.stdout);
    let json: serde_json::Value =
        serde_json::from_str(&json_str).map_err(|e| format!("解析 FFprobe 输出失败: {}", e))?;

    let streams = json["streams"]
        .as_array()
        .ok_or("未找到流信息")?;

    let mut video_stream = None;
    let mut audio_stream = None;
    for stream in streams {
        let codec_type = stream["codec_type"].as_str().unwrap_or("");
        if codec_type == "video" && video_stream.is_none() {
            video_stream = Some(stream);
        } else if codec_type == "audio" && audio_stream.is_none() {
            audio_stream = Some(stream);
        }
    }

    let stream = video_stream.ok_or("未找到视频流信息")?;
    let width = stream["width"]
        .as_u64()
        .ok_or("无法获取宽度")? as u32;
    let height = stream["height"]
        .as_u64()
        .ok_or("无法获取高度")? as u32;
    let codec = stream["codec_name"]
        .as_str()
        .unwrap_or("unknown")
        .to_string();
    let avg_frame_rate = stream["avg_frame_rate"]
        .as_str()
        .unwrap_or("N/A");
    let r_frame_rate = stream["r_frame_rate"]
        .as_str()
        .unwrap_or("N/A");
    let fps = if avg_frame_rate != "N/A" && !avg_frame_rate.is_empty() {
        avg_frame_rate.to_string()
    } else {
        r_frame_rate.to_string()
    };
    let duration = json["format"]["duration"]
        .as_str()
        .and_then(|s| s.parse::<f64>().ok())
        .or_else(|| {
            stream["duration"]
                .as_str()
                .and_then(|s| s.parse::<f64>().ok())
        })
        .unwrap_or(0.0);

    Ok(VideoInfo {
        codec,
        width,
        height,
        fps,
        duration,
        has_audio: audio_stream.is_some(),
    })
}

/// 检测所有视频的兼容性
async fn check_video_compatibility(
    app: &AppHandle,
    videos: &[PathBuf],
) -> Result<CompatibilityResult, String> {
    let mut videos_info = Vec::new();

    for video in videos {
        let info = get_video_info(app, video).await?;
        videos_info.push((
            video.file_name().unwrap().to_string_lossy().to_string(),
            info,
        ));
    }

    if videos_info.is_empty() {
        return Ok(CompatibilityResult {
            compatible: true,
            message: "没有视频需要检测".to_string(),
            videos_info,
        });
    }

    let mut compatible = true;
    let mut issues = Vec::new();

    for (name, info) in &videos_info {
        if info.width == 0 || info.height == 0 {
            compatible = false;
            issues.push(format!("{}: 无法解析分辨率", name));
        }
        if info.duration <= 0.0 {
            compatible = false;
            issues.push(format!("{}: 无法解析时长", name));
        }
    }

    let message = if compatible {
        "视频信息解析完成，将统一重编码以保证音画同步".to_string()
    } else {
        format!("检测到兼容性问题:\n{}", issues.join("\n"))
    };

    Ok(CompatibilityResult {
        compatible,
        message,
        videos_info,
    })
}

/// 检测给定路径列表的视频兼容性（供外部模块使用）
pub async fn check_video_compatibility_for_paths(
    app: &AppHandle,
    paths: &[PathBuf],
) -> Result<Vec<(String, VideoInfo)>, String> {
    let mut videos_info = Vec::new();

    for video in paths {
        let info = get_video_info(app, video).await?;
        videos_info.push((
            video.file_name().unwrap().to_string_lossy().to_string(),
            info,
        ));
    }

    // 检查兼容性
    for (name, info) in &videos_info {
        if info.width == 0 || info.height == 0 {
            return Err(format!("{}: 无法解析分辨率", name));
        }
        if info.duration <= 0.0 {
            return Err(format!("{}: 无法解析时长", name));
        }
    }

    Ok(videos_info)
}

pub fn build_concat_filter(
    videos_info: &[(String, VideoInfo)],
    target_width: u32,
    target_height: u32,
) -> Result<String, String> {
    let mut parts = Vec::new();
    for (idx, (_, info)) in videos_info.iter().enumerate() {
        parts.push(format!(
            "[{idx}:v]scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p,setpts=PTS-STARTPTS[v{idx}]",
            w = target_width,
            h = target_height
        ));

        if info.has_audio {
            parts.push(format!(
                "[{idx}:a]aresample=async=1:first_pts=0,aformat=sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS[a{idx}]"
            ));
        } else {
            let duration = if info.duration > 0.0 {
                info.duration
            } else {
                return Err(format!("无法获取第 {} 个视频时长，无法补齐静音音轨", idx + 1));
            };
            parts.push(format!(
                "anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration={:.6},asetpts=PTS-STARTPTS[a{idx}]",
                duration
            ));
        }
    }

    let mut concat_inputs = String::new();
    for idx in 0..videos_info.len() {
        concat_inputs.push_str(&format!("[v{idx}][a{idx}]"));
    }
    parts.push(format!(
        "{}concat=n={}:v=1:a=1[outv][outa]",
        concat_inputs,
        videos_info.len()
    ));

    Ok(parts.join(";"))
}

/// 主命令：拼接视频（快速模式，使用 -c copy）
#[tauri::command]
pub async fn concat_videos(
    app: AppHandle,
    pool_manager: State<'_, VideoPoolManager>,  // 新增
    input_dir: String,
    ending_video: Option<String>,
    random_count_min: usize,
    random_count_max: usize,
    max_depth: usize,
    run_times: usize,
    output_dir: String,
) -> Result<String, String> {
    let window = app.get_webview_window("main").unwrap();

    // 验证输入
    if input_dir.is_empty() {
        return Err("输入目录不能为空".to_string());
    }
    if output_dir.is_empty() {
        return Err("输出目录不能为空".to_string());
    }
    if random_count_min == 0 || random_count_max == 0 {
        return Err("随机数量必须大于 0".to_string());
    }
    if random_count_min > random_count_max {
        return Err("随机数量范围不合法".to_string());
    }
    if run_times == 0 {
        return Err("执行次数必须大于 0".to_string());
    }

    // 发送进度
    window
        .emit("progress", "正在扫描视频文件...")
        .map_err(|e| format!("发送进度事件失败: {}", e))?;

    // 收集视频列表
    let all_videos = collect_videos(&input_dir, max_depth)?;
    let available_count = all_videos.len();

    if available_count == 0 {
        return Err(format!("在目录中未找到 MP4 文件: {}", input_dir));
    }

    let mut output_paths = Vec::new();
    let base_timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();

    // 初始化视频池
    pool_manager.get_or_create_pool(&input_dir, max_depth, all_videos.clone());

    for run_index in 1..=run_times {
        let desired_count = if random_count_min == random_count_max {
            random_count_min
        } else {
            rand::thread_rng().gen_range(random_count_min..=random_count_max)
        };

        let actual_count = desired_count.min(available_count);

        // 从池子中抽取视频（不放回）
        let mut videos = pool_manager.draw_videos(&input_dir, max_depth, actual_count)?;

        if desired_count > available_count {
            window
                .emit(
                    "progress",
                    format!(
                        "第 {}/{} 次：请求 {} 个视频，但只找到 {} 个，将使用全部 {} 个视频",
                        run_index, run_times, desired_count, available_count, available_count
                    ),
                )
                .map_err(|e| format!("发送进度事件失败: {}", e))?;
        } else {
            // 检查是否触发了池子重填
            let remaining = pool_manager.get_remaining_count(&input_dir, max_depth);

            let msg = if remaining + videos.len() == available_count {
                format!("第 {}/{} 次：池子已抽完，重新填充。本次选择 {} 个视频", run_index, run_times, videos.len())
            } else {
                format!("第 {}/{} 次：已选择 {} 个视频（池子剩余 {}）", run_index, run_times, videos.len(), remaining)
            };

            window.emit("progress", msg)
                .map_err(|e| format!("发送进度事件失败: {}", e))?;
        }

        // 添加结尾视频
        if let Some(ending) = &ending_video {
            if !ending.is_empty() {
                let ending_path = PathBuf::from(ending);
                if !ending_path.exists() {
                    return Err(format!("结尾视频不存在: {}", ending));
                }
                videos.push(ending_path);
                window
                    .emit("progress", "已添加结尾视频")
                    .map_err(|e| format!("发送进度事件失败: {}", e))?;
            }
        }

        // 检测兼容性
        window
            .emit(
                "progress",
                format!("第 {}/{} 次：正在检测视频兼容性...", run_index, run_times),
            )
            .map_err(|e| format!("发送进度事件失败: {}", e))?;

        let compatibility = check_video_compatibility(&app, &videos).await?;

        if !compatibility.compatible {
            return Err(format!(
                "INCOMPATIBLE_VIDEOS:第 {} 次生成：\n{}",
                run_index,
                compatibility.message.clone()
            ));
        }

        // 生成输出文件名
        let output_file_name = if run_times == 1 {
            format!("output_{}.mp4", base_timestamp)
        } else {
            format!("output_{}_{}.mp4", base_timestamp, run_index)
        };
        let output_path = PathBuf::from(&output_dir).join(output_file_name);

        let (target_width, target_height) = compatibility
            .videos_info
            .first()
            .map(|(_, info)| (info.width, info.height))
            .ok_or("无法获取目标分辨率")?;

        let filter = build_concat_filter(&compatibility.videos_info, target_width, target_height)?;

        // 调用 FFmpeg 拼接（统一重编码）
        window
            .emit(
                "progress",
                format!("第 {}/{} 次：正在拼接视频（统一重编码以保证同步）...", run_index, run_times),
            )
            .map_err(|e| format!("发送进度事件失败: {}", e))?;

        let sidecar = app
            .shell()
            .sidecar("ffmpeg")
            .map_err(|e| format!("FFmpeg 启动失败: {}", e))?;

        let mut args: Vec<String> = Vec::new();
        for video in &videos {
            args.push("-i".to_string());
            args.push(video.to_string_lossy().to_string());
        }
        args.push("-filter_complex".to_string());
        args.push(filter);
        args.push("-map".to_string());
        args.push("[outv]".to_string());
        args.push("-map".to_string());
        args.push("[outa]".to_string());
        args.push("-vsync".to_string());
        args.push("vfr".to_string());
        args.push("-c:v".to_string());
        args.push("libx264".to_string());
        args.push("-preset".to_string());
        args.push("fast".to_string());
        args.push("-crf".to_string());
        args.push("23".to_string());
        args.push("-pix_fmt".to_string());
        args.push("yuv420p".to_string());
        args.push("-c:a".to_string());
        args.push("aac".to_string());
        args.push("-b:a".to_string());
        args.push("192k".to_string());
        args.push("-fflags".to_string());
        args.push("+genpts".to_string());
        args.push("-avoid_negative_ts".to_string());
        args.push("make_zero".to_string());
        args.push("-shortest".to_string());
        args.push(output_path.to_string_lossy().to_string());

        let output = sidecar
            .args(args)
            .output()
            .await
            .map_err(|e| format!("FFmpeg 执行失败: {}", e))?;

        if !output.status.success() {
            return Err(format!(
                "FFmpeg 执行失败: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }

        output_paths.push(output_path);
    }

    window
        .emit("progress", "完成！")
        .map_err(|e| format!("发送进度事件失败: {}", e))?;

    if output_paths.len() == 1 {
        Ok(format!(
            "视频拼接完成！输出文件: {}",
            output_paths[0].display()
        ))
    } else {
        let list = output_paths
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<_>>()
            .join("\n");
        Ok(format!("视频拼接完成！共生成 {} 个视频：\n{}", output_paths.len(), list))
    }
}

/// 备选命令：重新编码拼接视频
#[tauri::command]
pub async fn concat_videos_with_reencode(
    app: AppHandle,
    pool_manager: State<'_, VideoPoolManager>,  // 新增
    input_dir: String,
    ending_video: Option<String>,
    random_count_min: usize,
    random_count_max: usize,
    max_depth: usize,
    run_times: usize,
    output_dir: String,
) -> Result<String, String> {
    let window = app.get_webview_window("main").unwrap();

    // 验证输入
    if input_dir.is_empty() {
        return Err("输入目录不能为空".to_string());
    }
    if output_dir.is_empty() {
        return Err("输出目录不能为空".to_string());
    }
    if random_count_min == 0 || random_count_max == 0 {
        return Err("随机数量必须大于 0".to_string());
    }
    if random_count_min > random_count_max {
        return Err("随机数量范围不合法".to_string());
    }
    if run_times == 0 {
        return Err("执行次数必须大于 0".to_string());
    }

    // 发送进度
    window
        .emit("progress", "正在扫描视频文件...")
        .map_err(|e| format!("发送进度事件失败: {}", e))?;

    // 收集视频列表
    let all_videos = collect_videos(&input_dir, max_depth)?;
    let available_count = all_videos.len();

    if available_count == 0 {
        return Err(format!("在目录中未找到 MP4 文件: {}", input_dir));
    }

    let mut output_paths = Vec::new();
    let base_timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();

    // 初始化视频池
    pool_manager.get_or_create_pool(&input_dir, max_depth, all_videos.clone());

    for run_index in 1..=run_times {
        let desired_count = if random_count_min == random_count_max {
            random_count_min
        } else {
            rand::thread_rng().gen_range(random_count_min..=random_count_max)
        };

        let actual_count = desired_count.min(available_count);

        // 从池子中抽取视频（不放回）
        let mut videos = pool_manager.draw_videos(&input_dir, max_depth, actual_count)?;

        if desired_count > available_count {
            window
                .emit(
                    "progress",
                    format!(
                        "第 {}/{} 次：请求 {} 个视频，但只找到 {} 个，将使用全部 {} 个视频",
                        run_index, run_times, desired_count, available_count, available_count
                    ),
                )
                .map_err(|e| format!("发送进度事件失败: {}", e))?;
        } else {
            // 检查是否触发了池子重填
            let remaining = pool_manager.get_remaining_count(&input_dir, max_depth);

            let msg = if remaining + videos.len() == available_count {
                format!("第 {}/{} 次：池子已抽完，重新填充。本次选择 {} 个视频", run_index, run_times, videos.len())
            } else {
                format!("第 {}/{} 次：已选择 {} 个视频（池子剩余 {}）", run_index, run_times, videos.len(), remaining)
            };

            window.emit("progress", msg)
                .map_err(|e| format!("发送进度事件失败: {}", e))?;
        }

        // 添加结尾视频
        if let Some(ending) = &ending_video {
            if !ending.is_empty() {
                let ending_path = PathBuf::from(ending);
                if !ending_path.exists() {
                    return Err(format!("结尾视频不存在: {}", ending));
                }
                videos.push(ending_path);
                window
                    .emit("progress", "已添加结尾视频")
                    .map_err(|e| format!("发送进度事件失败: {}", e))?;
            }
        }

        // 生成输出文件名
        let output_file_name = if run_times == 1 {
            format!("output_{}.mp4", base_timestamp)
        } else {
            format!("output_{}_{}.mp4", base_timestamp, run_index)
        };
        let output_path = PathBuf::from(&output_dir).join(output_file_name);

        let compatibility = check_video_compatibility(&app, &videos).await?;

        if !compatibility.compatible {
            return Err(format!(
                "INCOMPATIBLE_VIDEOS:第 {} 次生成：\n{}",
                run_index,
                compatibility.message.clone()
            ));
        }

        let (target_width, target_height) = compatibility
            .videos_info
            .first()
            .map(|(_, info)| (info.width, info.height))
            .ok_or("无法获取目标分辨率")?;

        let filter = build_concat_filter(&compatibility.videos_info, target_width, target_height)?;

        // 调用 FFmpeg 拼接（统一重编码）
        window
            .emit(
                "progress",
                format!(
                    "第 {}/{} 次：正在拼接视频（统一重编码以保证同步）...",
                    run_index, run_times
                ),
            )
            .map_err(|e| format!("发送进度事件失败: {}", e))?;

        let sidecar = app
            .shell()
            .sidecar("ffmpeg")
            .map_err(|e| format!("FFmpeg 启动失败: {}", e))?;

        let mut args: Vec<String> = Vec::new();
        for video in &videos {
            args.push("-i".to_string());
            args.push(video.to_string_lossy().to_string());
        }
        args.push("-filter_complex".to_string());
        args.push(filter);
        args.push("-map".to_string());
        args.push("[outv]".to_string());
        args.push("-map".to_string());
        args.push("[outa]".to_string());
        args.push("-vsync".to_string());
        args.push("vfr".to_string());
        args.push("-c:v".to_string());
        args.push("libx264".to_string());
        args.push("-preset".to_string());
        args.push("fast".to_string());
        args.push("-crf".to_string());
        args.push("23".to_string());
        args.push("-pix_fmt".to_string());
        args.push("yuv420p".to_string());
        args.push("-c:a".to_string());
        args.push("aac".to_string());
        args.push("-b:a".to_string());
        args.push("192k".to_string());
        args.push("-fflags".to_string());
        args.push("+genpts".to_string());
        args.push("-avoid_negative_ts".to_string());
        args.push("make_zero".to_string());
        args.push("-shortest".to_string());
        args.push(output_path.to_string_lossy().to_string());

        let output = sidecar
            .args(args)
            .output()
            .await
            .map_err(|e| format!("FFmpeg 执行失败: {}", e))?;

        if !output.status.success() {
            return Err(format!(
                "FFmpeg 执行失败: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }

        output_paths.push(output_path);
    }

    window
        .emit("progress", "完成！")
        .map_err(|e| format!("发送进度事件失败: {}", e))?;

    if output_paths.len() == 1 {
        Ok(format!(
            "视频拼接完成！输出文件: {}",
            output_paths[0].display()
        ))
    } else {
        let list = output_paths
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<_>>()
            .join("\n");
        Ok(format!("视频拼接完成！共生成 {} 个视频：\n{}", output_paths.len(), list))
    }
}
