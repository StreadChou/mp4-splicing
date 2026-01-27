use rand::seq::SliceRandom;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::ShellExt;
use walkdir::WalkDir;

#[derive(Debug, Serialize, Deserialize)]
pub struct VideoInfo {
    pub codec: String,
    pub width: u32,
    pub height: u32,
    pub fps: String,
}

#[derive(Debug, Serialize)]
pub struct CompatibilityResult {
    pub compatible: bool,
    pub message: String,
    pub videos_info: Vec<(String, VideoInfo)>,
}

/// 从目录中随机选择指定数量的 MP4 视频
fn get_random_videos(dir: &str, count: usize) -> Result<(Vec<PathBuf>, usize), String> {
    let path = Path::new(dir);
    if !path.exists() {
        return Err(format!("目录不存在: {}", dir));
    }
    if !path.is_dir() {
        return Err(format!("路径不是目录: {}", dir));
    }

    let mut videos: Vec<PathBuf> = WalkDir::new(path)
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

    let available_count = videos.len();
    let actual_count = count.min(available_count);

    let mut rng = rand::thread_rng();
    videos.shuffle(&mut rng);
    videos.truncate(actual_count);

    Ok((videos, available_count))
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
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=codec_name,width,height,r_frame_rate",
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

    let stream = json["streams"]
        .as_array()
        .and_then(|arr| arr.first())
        .ok_or("未找到视频流信息")?;

    Ok(VideoInfo {
        codec: stream["codec_name"]
            .as_str()
            .unwrap_or("unknown")
            .to_string(),
        width: stream["width"].as_u64().unwrap_or(0) as u32,
        height: stream["height"].as_u64().unwrap_or(0) as u32,
        fps: stream["r_frame_rate"]
            .as_str()
            .unwrap_or("unknown")
            .to_string(),
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

    let first = &videos_info[0].1;
    let mut compatible = true;
    let mut issues = Vec::new();

    for (name, info) in &videos_info[1..] {
        if info.codec != first.codec {
            compatible = false;
            issues.push(format!(
                "{}: 编码格式不同 ({} vs {})",
                name, info.codec, first.codec
            ));
        }
        if info.width != first.width || info.height != first.height {
            compatible = false;
            issues.push(format!(
                "{}: 分辨率不同 ({}x{} vs {}x{})",
                name, info.width, info.height, first.width, first.height
            ));
        }
        if info.fps != first.fps {
            compatible = false;
            issues.push(format!(
                "{}: 帧率不同 ({} vs {})",
                name, info.fps, first.fps
            ));
        }
    }

    let message = if compatible {
        "所有视频格式兼容，可以直接拼接".to_string()
    } else {
        format!("检测到兼容性问题:\n{}", issues.join("\n"))
    };

    Ok(CompatibilityResult {
        compatible,
        message,
        videos_info,
    })
}

/// 创建 FFmpeg concat 格式的文件列表
fn create_concat_file(videos: &[PathBuf], temp_dir: &Path) -> Result<PathBuf, String> {
    let concat_file = temp_dir.join("concat_list.txt");
    let mut file =
        File::create(&concat_file).map_err(|e| format!("创建 concat 文件失败: {}", e))?;

    for video in videos {
        let abs_path = video
            .canonicalize()
            .map_err(|e| format!("获取绝对路径失败: {}", e))?;
        writeln!(file, "file '{}'", abs_path.display())
            .map_err(|e| format!("写入 concat 文件失败: {}", e))?;
    }

    Ok(concat_file)
}

/// 主命令：拼接视频（快速模式，使用 -c copy）
#[tauri::command]
pub async fn concat_videos(
    app: AppHandle,
    input_dir: String,
    ending_video: Option<String>,
    random_count: usize,
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
    if random_count == 0 {
        return Err("随机数量必须大于 0".to_string());
    }

    // 发送进度
    window
        .emit("progress", "正在扫描视频文件...")
        .map_err(|e| format!("发送进度事件失败: {}", e))?;

    // 随机选择视频
    let (mut videos, available_count) = get_random_videos(&input_dir, random_count)?;

    if random_count > available_count {
        window
            .emit(
                "progress",
                format!(
                    "请求 {} 个视频，但只找到 {} 个，将使用全部 {} 个视频",
                    random_count, available_count, available_count
                ),
            )
            .map_err(|e| format!("发送进度事件失败: {}", e))?;
    } else {
        window
            .emit("progress", format!("已选择 {} 个视频", videos.len()))
            .map_err(|e| format!("发送进度事件失败: {}", e))?;
    }

    // 添加结尾视频
    if let Some(ending) = ending_video {
        if !ending.is_empty() {
            let ending_path = PathBuf::from(&ending);
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
        .emit("progress", "正在检测视频兼容性...")
        .map_err(|e| format!("发送进度事件失败: {}", e))?;

    let compatibility = check_video_compatibility(&app, &videos).await?;

    if !compatibility.compatible {
        return Err(format!("INCOMPATIBLE_VIDEOS:{}", compatibility.message));
    }

    // 创建临时目录
    let temp_dir = std::env::temp_dir().join(format!("mp4handler_{}", chrono::Local::now().timestamp()));
    fs::create_dir_all(&temp_dir).map_err(|e| format!("创建临时目录失败: {}", e))?;

    // 创建 concat 文件
    let concat_file = create_concat_file(&videos, &temp_dir)?;

    // 生成输出文件名
    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
    let output_path = PathBuf::from(&output_dir).join(format!("output_{}.mp4", timestamp));

    // 调用 FFmpeg 拼接（快速模式）
    window
        .emit("progress", "正在拼接视频（快速模式）...")
        .map_err(|e| format!("发送进度事件失败: {}", e))?;

    let sidecar = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("FFmpeg 启动失败: {}", e))?;

    let output = sidecar
        .args(&[
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            concat_file.to_str().unwrap(),
            "-c",
            "copy",
            output_path.to_str().unwrap(),
        ])
        .output()
        .await
        .map_err(|e| format!("FFmpeg 执行失败: {}", e))?;

    // 清理临时文件
    let _ = fs::remove_dir_all(&temp_dir);

    if !output.status.success() {
        return Err(format!(
            "FFmpeg 执行失败: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    window
        .emit("progress", "完成！")
        .map_err(|e| format!("发送进度事件失败: {}", e))?;

    Ok(format!(
        "视频拼接完成！输出文件: {}",
        output_path.display()
    ))
}

/// 备选命令：重新编码拼接视频
#[tauri::command]
pub async fn concat_videos_with_reencode(
    app: AppHandle,
    input_dir: String,
    ending_video: Option<String>,
    random_count: usize,
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
    if random_count == 0 {
        return Err("随机数量必须大于 0".to_string());
    }

    // 发送进度
    window
        .emit("progress", "正在扫描视频文件...")
        .map_err(|e| format!("发送进度事件失败: {}", e))?;

    // 随机选择视频
    let (mut videos, available_count) = get_random_videos(&input_dir, random_count)?;

    if random_count > available_count {
        window
            .emit(
                "progress",
                format!(
                    "请求 {} 个视频，但只找到 {} 个，将使用全部 {} 个视频",
                    random_count, available_count, available_count
                ),
            )
            .map_err(|e| format!("发送进度事件失败: {}", e))?;
    } else {
        window
            .emit("progress", format!("已选择 {} 个视频", videos.len()))
            .map_err(|e| format!("发送进度事件失败: {}", e))?;
    }

    // 添加结尾视频
    if let Some(ending) = ending_video {
        if !ending.is_empty() {
            let ending_path = PathBuf::from(&ending);
            if !ending_path.exists() {
                return Err(format!("结尾视频不存在: {}", ending));
            }
            videos.push(ending_path);
            window
                .emit("progress", "已添加结尾视频")
                .map_err(|e| format!("发送进度事件失败: {}", e))?;
        }
    }

    // 创建临时目录
    let temp_dir = std::env::temp_dir().join(format!("mp4handler_{}", chrono::Local::now().timestamp()));
    fs::create_dir_all(&temp_dir).map_err(|e| format!("创建临时目录失败: {}", e))?;

    // 创建 concat 文件
    let concat_file = create_concat_file(&videos, &temp_dir)?;

    // 生成输出文件名
    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
    let output_path = PathBuf::from(&output_dir).join(format!("output_{}.mp4", timestamp));

    // 调用 FFmpeg 拼接（重新编码模式）
    window
        .emit("progress", "正在拼接视频（重新编码模式，这可能需要较长时间）...")
        .map_err(|e| format!("发送进度事件失败: {}", e))?;

    let sidecar = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("FFmpeg 启动失败: {}", e))?;

    let output = sidecar
        .args(&[
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            concat_file.to_str().unwrap(),
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "23",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            output_path.to_str().unwrap(),
        ])
        .output()
        .await
        .map_err(|e| format!("FFmpeg 执行失败: {}", e))?;

    // 清理临时文件
    let _ = fs::remove_dir_all(&temp_dir);

    if !output.status.success() {
        return Err(format!(
            "FFmpeg 执行失败: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    window
        .emit("progress", "完成！")
        .map_err(|e| format!("发送进度事件失败: {}", e))?;

    Ok(format!(
        "视频拼接完成！输出文件: {}",
        output_path.display()
    ))
}
