use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::ShellExt;

#[derive(Serialize, Deserialize, Clone)]
pub struct VideoMetadata {
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub duration: f64,
    pub total_frames: u32,
    pub codec: String,
}

#[derive(Serialize, Deserialize)]
pub struct FrameInfo {
    pub frame_number: u32,
    pub timestamp: f64,
    pub image_path: String,
}

#[derive(Serialize, Deserialize)]
pub struct SegmentRange {
    pub start_frame: u32,
    pub end_frame: u32,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct VideoTask {
    pub path: String,
    pub name: String,
    pub status: String,
}

#[derive(Serialize, Deserialize)]
pub struct BatchProgress {
    pub input_dir: String,
    pub output_dir: String,
    pub tasks: Vec<VideoTask>,
    pub current_index: usize,
}

// 计算文件路径的哈希值（用于临时目录命名）
fn calculate_hash(path: &str) -> String {
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

// 获取视频元数据
#[tauri::command]
pub async fn get_video_metadata(
    app: AppHandle,
    video_path: String,
) -> Result<VideoMetadata, String> {
    get_video_metadata_internal(&app, &video_path).await
}

// 内部使用的元数据获取
async fn get_video_metadata_internal(
    app: &AppHandle,
    video_path: &str,
) -> Result<VideoMetadata, String> {
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
            "stream=codec_name,width,height,r_frame_rate,duration",
            "-show_entries",
            "format=duration",
            "-of",
            "json",
            video_path,
        ])
        .output()
        .await
        .map_err(|e| format!("FFprobe 执行失败: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "FFprobe 失败: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let json_str = String::from_utf8_lossy(&output.stdout);
    let json: serde_json::Value =
        serde_json::from_str(&json_str).map_err(|e| format!("解析 JSON 失败: {}", e))?;

    let stream = json["streams"][0]
        .as_object()
        .ok_or("无法获取视频流信息")?;

    let width = stream["width"].as_u64().ok_or("无法获取宽度")? as u32;
    let height = stream["height"].as_u64().ok_or("无法获取高度")? as u32;
    let codec = stream["codec_name"]
        .as_str()
        .ok_or("无法获取编码格式")?
        .to_string();

    // 解析帧率 (如 "30/1" 或 "30000/1001")
    let r_frame_rate = stream["r_frame_rate"]
        .as_str()
        .ok_or("无法获取帧率")?;
    let fps = if r_frame_rate.contains('/') {
        let parts: Vec<&str> = r_frame_rate.split('/').collect();
        if parts.len() == 2 {
            let num: f64 = parts[0]
                .parse()
                .map_err(|_| "无法解析帧率分子")?;
            let den: f64 = parts[1]
                .parse()
                .map_err(|_| "无法解析帧率分母")?;
            num / den
        } else {
            return Err("帧率格式错误".to_string());
        }
    } else {
        r_frame_rate
            .parse()
            .map_err(|_| "无法解析帧率")?
    };

    // 获取时长（优先从流中获取，否则从格式中获取）
    let duration = if let Some(stream_duration) = stream.get("duration") {
        stream_duration
            .as_str()
            .and_then(|s| s.parse::<f64>().ok())
            .ok_or("无法解析时长")?
    } else {
        json["format"]["duration"]
            .as_str()
            .and_then(|s| s.parse::<f64>().ok())
            .ok_or("无法获取视频时长")?
    };

    let total_frames = (duration * fps).round() as u32;

    Ok(VideoMetadata {
        width,
        height,
        fps,
        duration,
        total_frames,
        codec,
    })
}

// 提取所有帧的缩略图
#[tauri::command]
pub async fn extract_all_frames(
    app: AppHandle,
    video_path: String,
) -> Result<Vec<FrameInfo>, String> {
    let window = app
        .get_webview_window("main")
        .ok_or("无法获取窗口")?;

    // 获取视频元数据
    let metadata = get_video_metadata_internal(&app, &video_path).await?;

    // 创建临时目录
    let video_hash = calculate_hash(&video_path);
    let temp_dir = std::env::temp_dir()
        .join(format!("mp4handler_{}", video_hash))
        .join("frames");

    // 清理旧的帧
    if temp_dir.exists() {
        fs::remove_dir_all(&temp_dir).map_err(|e| format!("清理临时目录失败: {}", e))?;
    }
    fs::create_dir_all(&temp_dir).map_err(|e| format!("创建临时目录失败: {}", e))?;

    // 使用 FFmpeg 提取所有帧（中等分辨率）
    let output_pattern = temp_dir.join("frame_%05d.jpg");
    let sidecar = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("FFmpeg 启动失败: {}", e))?;

    let _ = window.emit(
        "frame_progress",
        serde_json::json!({
            "message": "正在提取视频帧...",
            "percent": 0,
        }),
    );

    let output = sidecar
        .args(&[
            "-i",
            &video_path,
            "-vf",
            "scale=320:-1",
            "-q:v",
            "3",
            "-y",
            output_pattern.to_str().unwrap(),
        ])
        .output()
        .await
        .map_err(|e| format!("FFmpeg 执行失败: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "提取帧失败: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    // 扫描生成的帧文件
    let mut frames = Vec::new();
    let mut entries: Vec<_> = fs::read_dir(&temp_dir)
        .map_err(|e| format!("读取临时目录失败: {}", e))?
        .filter_map(|e| e.ok())
        .collect();

    entries.sort_by_key(|e| e.path());

    for (idx, entry) in entries.iter().enumerate() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some("jpg") {
            let frame_number = idx as u32;
            let timestamp = frame_number as f64 / metadata.fps;

            frames.push(FrameInfo {
                frame_number,
                timestamp,
                image_path: path.to_string_lossy().to_string(),
            });

            // 发送进度
            if idx % 30 == 0 || idx == entries.len() - 1 {
                let _ = window.emit(
                    "frame_progress",
                    serde_json::json!({
                        "message": format!("已提取 {}/{} 帧", idx + 1, entries.len()),
                        "percent": ((idx + 1) as f64 / entries.len() as f64 * 100.0) as u32,
                    }),
                );
            }
        }
    }

    Ok(frames)
}

// 生成视频片段
#[tauri::command]
pub async fn generate_video_segments(
    app: AppHandle,
    video_path: String,
    segments: Vec<SegmentRange>,
    output_dir: String,
) -> Result<String, String> {
    let window = app
        .get_webview_window("main")
        .ok_or("无法获取窗口")?;

    // 获取视频元数据
    let metadata = get_video_metadata_internal(&app, &video_path).await?;

    // 创建输出目录：视频所在目录/视频名称/
    let video_name = Path::new(&video_path)
        .file_stem()
        .ok_or("无法获取视频文件名")?
        .to_string_lossy();
    let output_base_dir = PathBuf::from(&output_dir).join(&*video_name);
    fs::create_dir_all(&output_base_dir).map_err(|e| format!("创建输出目录失败: {}", e))?;

    // 逐个生成片段
    for (idx, segment) in segments.iter().enumerate() {
        let segment_num = idx + 1;
        let output_file = output_base_dir.join(format!("{}_{}.mp4", video_name, segment_num));

        // 计算时间戳
        let start_time = segment.start_frame as f64 / metadata.fps;
        let end_time = segment.end_frame as f64 / metadata.fps;

        // 发送进度
        let _ = window.emit(
            "segment_progress",
            serde_json::json!({
                "current": segment_num,
                "total": segments.len(),
                "segmentName": format!("{}_{}.mp4", video_name, segment_num),
                "percent": (segment_num as f32 / segments.len() as f32 * 100.0) as u32,
            }),
        );

        // 使用 FFmpeg 精确切片（重新编码以保证帧精度和编码一致性）
        let sidecar = app
            .shell()
            .sidecar("ffmpeg")
            .map_err(|e| format!("FFmpeg 启动失败: {}", e))?;

        let output = sidecar
            .args(&[
                "-ss",
                &start_time.to_string(),
                "-i",
                &video_path,
                "-to",
                &end_time.to_string(),
                "-c:v",
                "libx264",
                "-preset",
                "fast",
                "-crf",
                "18",
                "-r",
                &metadata.fps.to_string(),
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                "-y",
                output_file.to_str().unwrap(),
            ])
            .output()
            .await
            .map_err(|e| format!("FFmpeg 执行失败: {}", e))?;

        if !output.status.success() {
            return Err(format!(
                "生成片段 {} 失败: {}",
                segment_num,
                String::from_utf8_lossy(&output.stderr)
            ));
        }
    }

    Ok(format!(
        "成功生成 {} 个视频片段到: {}",
        segments.len(),
        output_base_dir.display()
    ))
}

// 列出目录中的所有 MP4 文件
#[tauri::command]
pub fn list_mp4_files(dir_path: String) -> Result<Vec<String>, String> {
    let path = Path::new(&dir_path);
    if !path.is_dir() {
        return Err("路径不是一个目录".to_string());
    }

    let mut mp4_files = Vec::new();
    let entries = fs::read_dir(path).map_err(|e| format!("读取目录失败: {}", e))?;

    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.is_file() {
            if let Some(ext) = path.extension() {
                if ext.to_string_lossy().to_lowercase() == "mp4" {
                    mp4_files.push(path.to_string_lossy().to_string());
                }
            }
        }
    }

    mp4_files.sort();
    Ok(mp4_files)
}

// 加载批量拆解进度
#[tauri::command]
pub fn load_batch_progress(progress_path: String) -> Result<Option<BatchProgress>, String> {
    let path = Path::new(&progress_path);
    if !path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(path).map_err(|e| format!("读取进度文件失败: {}", e))?;
    let progress: BatchProgress =
        serde_json::from_str(&content).map_err(|e| format!("解析进度文件失败: {}", e))?;

    Ok(Some(progress))
}

// 保存批量拆解进度
#[tauri::command]
pub fn save_batch_progress(
    progress_path: String,
    progress: BatchProgress,
) -> Result<(), String> {
    let content =
        serde_json::to_string_pretty(&progress).map_err(|e| format!("序列化进度失败: {}", e))?;
    fs::write(&progress_path, content).map_err(|e| format!("写入进度文件失败: {}", e))?;

    Ok(())
}

// 删除视频文件
#[tauri::command]
pub fn delete_video_file(file_path: String) -> Result<(), String> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err("文件不存在".to_string());
    }

    fs::remove_file(path).map_err(|e| format!("删除文件失败: {}", e))?;
    Ok(())
}
