use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::ShellExt;
use rayon::prelude::*;
use rand::seq::SliceRandom;
use crate::frame_similarity::{calculate_similarity, SimilarityAlgorithm};
use crate::video_processor::{check_video_compatibility_for_paths, build_concat_filter};

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

fn parse_rational(value: &str) -> Option<f64> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed == "N/A" {
        return None;
    }
    if let Some((num, den)) = trimmed.split_once('/') {
        let n: f64 = num.parse().ok()?;
        let d: f64 = den.parse().ok()?;
        if d == 0.0 {
            return None;
        }
        Some(n / d)
    } else {
        trimmed.parse().ok()
    }
}

fn normalize_timestamps(mut timestamps: Vec<f64>) -> Vec<f64> {
    let mut last = 0.0f64;
    for ts in timestamps.iter_mut() {
        if !ts.is_finite() || *ts < 0.0 {
            *ts = last;
        } else if *ts < last {
            *ts = last;
        }
        last = *ts;
    }
    if let Some(first) = timestamps.first().copied() {
        if first > 0.0 {
            for ts in timestamps.iter_mut() {
                *ts = (*ts - first).max(0.0);
            }
        }
    }
    timestamps
}

async fn probe_frame_timestamps(
    app: &AppHandle,
    video_path: &str,
    field: &str,
) -> Result<Vec<f64>, String> {
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
            "-show_frames",
            "-show_entries",
            &format!("frame={}", field),
            "-of",
            "csv=p=0",
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

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut timestamps = Vec::new();
    for line in stdout.lines() {
        let value = line.trim();
        if value.is_empty() || value == "N/A" {
            continue;
        }
        if let Ok(ts) = value.parse::<f64>() {
            timestamps.push(ts);
        }
    }

    if timestamps.is_empty() {
        return Ok(timestamps);
    }

    Ok(normalize_timestamps(timestamps))
}

async fn get_video_frame_timestamps(
    app: &AppHandle,
    video_path: &str,
) -> Result<Vec<f64>, String> {
    let candidates = ["best_effort_timestamp_time", "pkt_pts_time", "pkt_dts_time"];
    for field in candidates {
        let timestamps = probe_frame_timestamps(app, video_path, field).await?;
        if !timestamps.is_empty() {
            return Ok(timestamps);
        }
    }
    Err("无法获取帧时间戳".to_string())
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
            "-count_frames",
            "-show_entries",
            "stream=codec_name,width,height,r_frame_rate,avg_frame_rate,nb_read_frames,nb_frames",
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

    // 解析帧率（优先 avg_frame_rate，其次 r_frame_rate）
    let avg_frame_rate = stream["avg_frame_rate"].as_str().unwrap_or("N/A");
    let r_frame_rate = stream["r_frame_rate"].as_str().unwrap_or("N/A");
    let fps = parse_rational(avg_frame_rate)
        .or_else(|| parse_rational(r_frame_rate))
        .unwrap_or(0.0);

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

    let total_frames = stream["nb_read_frames"]
        .as_str()
        .and_then(|s| s.parse::<u64>().ok())
        .or_else(|| {
            stream["nb_frames"]
                .as_str()
                .and_then(|s| s.parse::<u64>().ok())
        })
        .map(|v| v as u32)
        .unwrap_or_else(|| {
            if fps > 0.0 {
                (duration * fps).round() as u32
            } else {
                0
            }
        });

    let fps = if fps > 0.0 {
        fps
    } else if duration > 0.0 && total_frames > 0 {
        total_frames as f64 / duration
    } else {
        0.0
    };

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

    let vf_filter = "scale=320:-1".to_string();

    let output = sidecar
        .args(&[
            "-i",
            &video_path,
            "-vf",
            &vf_filter,
            "-vsync",
            "0",
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

    let frame_timestamps = get_video_frame_timestamps(&app, &video_path).await?;
    let limit = std::cmp::min(entries.len(), frame_timestamps.len());
    for (idx, entry) in entries.iter().take(limit).enumerate() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some("jpg") {
            let frame_number = idx as u32;
            let timestamp = frame_timestamps
                .get(idx)
                .copied()
                .unwrap_or_else(|| frame_number as f64 / metadata.fps.max(1.0));

            frames.push(FrameInfo {
                frame_number,
                timestamp,
                image_path: path.to_string_lossy().to_string(),
            });

            // 发送进度
            if idx % 30 == 0 || idx == limit.saturating_sub(1) {
                let _ = window.emit(
                    "frame_progress",
                    serde_json::json!({
                        "message": format!("已提取 {}/{} 帧", idx + 1, limit),
                        "percent": ((idx + 1) as f64 / limit as f64 * 100.0) as u32,
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

    let frame_timestamps = get_video_frame_timestamps(&app, &video_path).await?;
    let total_frames = frame_timestamps.len();

    // 逐个生成片段
    for (idx, segment) in segments.iter().enumerate() {
        let segment_num = idx + 1;
        let output_file = output_base_dir.join(format!("{}_{}.mp4", video_name, segment_num));

        let start_idx = segment.start_frame as usize;
        let end_idx = segment.end_frame as usize;
        if start_idx >= total_frames || end_idx >= total_frames || start_idx > end_idx {
            return Err(format!("片段 {} 的帧范围无效", segment_num));
        }

        let start_time = frame_timestamps[start_idx];
        let end_time_exclusive = if end_idx + 1 < total_frames {
            frame_timestamps[end_idx + 1]
        } else {
            metadata.duration.max(frame_timestamps[end_idx])
        };
        let duration = (end_time_exclusive - start_time).max(0.0);

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
                "-i",
                &video_path,
                "-ss",
                &start_time.to_string(),
                "-t",
                &duration.to_string(),
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

// 自动拆解视频（基于帧相似度）
#[tauri::command]
pub async fn auto_split_video(
    app: AppHandle,
    video_path: String,
    output_dir: String,
    algorithm: String,
    threshold: f64,
    min_duration: f64,
    skip_first: bool,   // 新增：掐头
    skip_last: bool,    // 新增：去尾
) -> Result<String, String> {
    let window = app
        .get_webview_window("main")
        .ok_or("无法获取窗口")?;

    // 解析算法
    let algo = SimilarityAlgorithm::from_str(&algorithm)?;

    // 获取视频元数据
    let metadata = get_video_metadata_internal(&app, &video_path).await?;

    // 提取所有帧
    let _ = window.emit(
        "auto_split_progress",
        serde_json::json!({
            "message": "正在提取视频帧...",
            "percent": 0,
        }),
    );

    let frames = extract_all_frames_internal(&app, &video_path).await?;

    if frames.len() < 2 {
        return Err("视频帧数不足".to_string());
    }

    // 计算最小帧数
    let min_frames = (min_duration * metadata.fps).round() as u32;

    // 逐帧对比，找到切分点
    let _ = window.emit(
        "auto_split_progress",
        serde_json::json!({
            "message": "正在分析帧相似度...",
            "percent": 10,
        }),
    );

    let mut split_points = vec![0u32]; // 起始帧
    let mut last_split_frame = 0u32;

    // 并行计算所有帧对的相似度
    let progress_counter = Arc::new(AtomicUsize::new(0));
    let total_frames = frames.len();
    let window_clone = window.clone();

    let similarities: Vec<(usize, f64)> = (1..frames.len())
        .into_par_iter()
        .map(|i| {
            let prev_frame = &frames[i - 1];
            let curr_frame = &frames[i];

            let similarity = calculate_similarity(
                &prev_frame.image_path,
                &curr_frame.image_path,
                algo,
            ).unwrap_or(1.0); // 出错时默认为完全相似

            // 更新进度计数器
            let current = progress_counter.fetch_add(1, Ordering::Relaxed);

            // 每 100 帧发送一次进度（减少开销）
            if current % 100 == 0 {
                let percent = 10 + ((current as f64 / total_frames as f64) * 60.0) as u32;
                let _ = window_clone.emit(
                    "auto_split_progress",
                    serde_json::json!({
                        "message": format!("已分析 {}/{} 帧", current, total_frames),
                        "percent": percent,
                    }),
                );
            }

            (i, similarity)
        })
        .collect();

    // 串行处理切分点（需要维护状态）
    for (i, similarity) in similarities {
        let curr_frame = &frames[i];

        // 如果相似度低于阈值，且距离上次切分点足够远
        if similarity < threshold {
            let frames_since_last_split = curr_frame.frame_number - last_split_frame;
            if frames_since_last_split >= min_frames {
                split_points.push(curr_frame.frame_number);
                last_split_frame = curr_frame.frame_number;
            }
        }
    }

    // 发送最终进度
    let _ = window.emit(
        "auto_split_progress",
        serde_json::json!({
            "message": format!("已分析 {}/{} 帧", total_frames, total_frames),
            "percent": 70,
        }),
    );

    // 添加结束帧
    if split_points.last() != Some(&(frames.len() as u32 - 1)) {
        split_points.push(frames.len() as u32 - 1);
    }

    // 生成片段范围
    let mut segments = Vec::new();
    for i in 0..split_points.len() - 1 {
        segments.push(SegmentRange {
            start_frame: split_points[i],
            end_frame: split_points[i + 1] - 1,
        });
    }

    if segments.is_empty() {
        return Err("未检测到场景切换，无法拆分".to_string());
    }

    // 新增：根据掐头去尾选项过滤片段
    let original_count = segments.len();
    if skip_first && segments.len() > 1 {
        segments.remove(0);
    }
    if skip_last && segments.len() > 1 {
        segments.pop();
    }

    if segments.is_empty() {
        return Err(format!(
            "过滤后无片段可输出（原始片段数: {}，掐头: {}，去尾: {}）",
            original_count, skip_first, skip_last
        ));
    }

    // 发送过滤信息
    let _ = window.emit(
        "auto_split_progress",
        serde_json::json!({
            "message": format!(
                "识别到 {} 个片段，过滤后输出 {} 个",
                original_count, segments.len()
            ),
            "percent": 70,
        }),
    );

    // 生成视频片段
    let _ = window.emit(
        "auto_split_progress",
        serde_json::json!({
            "message": "正在生成视频片段...",
            "percent": 70,
        }),
    );

    let result = generate_video_segments(app, video_path, segments, output_dir).await?;

    let _ = window.emit(
        "auto_split_progress",
        serde_json::json!({
            "message": "完成",
            "percent": 100,
        }),
    );

    Ok(result)
}

// 内部使用的帧提取（不发送进度事件）
async fn extract_all_frames_internal(
    app: &AppHandle,
    video_path: &str,
) -> Result<Vec<FrameInfo>, String> {
    let metadata = get_video_metadata_internal(app, video_path).await?;

    // 创建临时目录
    let video_hash = calculate_hash(video_path);
    let temp_dir = std::env::temp_dir()
        .join(format!("mp4handler_{}", video_hash))
        .join("frames");

    // 清理旧的帧
    if temp_dir.exists() {
        fs::remove_dir_all(&temp_dir).map_err(|e| format!("清理临时目录失败: {}", e))?;
    }
    fs::create_dir_all(&temp_dir).map_err(|e| format!("创建临时目录失败: {}", e))?;

    // 使用 FFmpeg 提取所有帧
    let output_pattern = temp_dir.join("frame_%05d.jpg");
    let sidecar = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("FFmpeg 启动失败: {}", e))?;

    let vf_filter = "scale=320:-1".to_string();

    let output = sidecar
        .args(&[
            "-i",
            video_path,
            "-vf",
            &vf_filter,
            "-vsync",
            "0",
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

    let frame_timestamps = get_video_frame_timestamps(app, video_path).await?;
    let limit = std::cmp::min(entries.len(), frame_timestamps.len());
    for (idx, entry) in entries.iter().take(limit).enumerate() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some("jpg") {
            let frame_number = idx as u32;
            let timestamp = frame_timestamps
                .get(idx)
                .copied()
                .unwrap_or_else(|| frame_number as f64 / metadata.fps.max(1.0));

            frames.push(FrameInfo {
                frame_number,
                timestamp,
                image_path: path.to_string_lossy().to_string(),
            });
        }
    }

    Ok(frames)
}

// 去结尾并合成视频
#[tauri::command]
pub async fn remove_ending_and_concat(
    app: AppHandle,
    video_path: String,
    output_dir: String,
    algorithm: String,
    threshold: f64,
    min_duration: f64,
    new_ending_video: Option<String>,
    shuffle_segments: bool,
) -> Result<String, String> {
    let window = app
        .get_webview_window("main")
        .ok_or("无法获取窗口")?;

    // 解析算法
    let algo = SimilarityAlgorithm::from_str(&algorithm)?;

    // 获取视频元数据
    let metadata = get_video_metadata_internal(&app, &video_path).await?;

    // 提取所有帧
    let _ = window.emit(
        "remove_ending_progress",
        serde_json::json!({
            "message": "正在提取视频帧...",
            "percent": 0,
        }),
    );

    let frames = extract_all_frames_internal(&app, &video_path).await?;

    if frames.len() < 2 {
        return Err("视频帧数不足".to_string());
    }

    let _ = window.emit(
        "remove_ending_progress",
        serde_json::json!({
            "message": "帧提取完成",
            "percent": 10,
        }),
    );

    // 计算最小帧数
    let min_frames = (min_duration * metadata.fps).round() as u32;

    // 并行计算相似度
    let _ = window.emit(
        "remove_ending_progress",
        serde_json::json!({
            "message": "正在分析帧相似度...",
            "percent": 10,
        }),
    );

    let mut split_points = vec![0u32];
    let mut last_split_frame = 0u32;

    let progress_counter = Arc::new(AtomicUsize::new(0));
    let total_frames = frames.len();
    let window_clone = window.clone();

    let similarities: Vec<(usize, f64)> = (1..frames.len())
        .into_par_iter()
        .map(|i| {
            let prev_frame = &frames[i - 1];
            let curr_frame = &frames[i];

            let similarity = calculate_similarity(
                &prev_frame.image_path,
                &curr_frame.image_path,
                algo,
            ).unwrap_or(1.0);

            let current = progress_counter.fetch_add(1, Ordering::Relaxed);

            if current % 100 == 0 {
                let percent = 10 + ((current as f64 / total_frames as f64) * 50.0) as u32;
                let _ = window_clone.emit(
                    "remove_ending_progress",
                    serde_json::json!({
                        "message": format!("已分析 {}/{} 帧", current, total_frames),
                        "percent": percent,
                    }),
                );
            }

            (i, similarity)
        })
        .collect();

    // 串行处理切分点
    for (i, similarity) in similarities {
        let curr_frame = &frames[i];

        if similarity < threshold {
            let frames_since_last_split = curr_frame.frame_number - last_split_frame;
            if frames_since_last_split >= min_frames {
                split_points.push(curr_frame.frame_number);
                last_split_frame = curr_frame.frame_number;
            }
        }
    }

    let _ = window.emit(
        "remove_ending_progress",
        serde_json::json!({
            "message": format!("已分析 {}/{} 帧", total_frames, total_frames),
            "percent": 60,
        }),
    );

    // 添加结束帧
    if split_points.last() != Some(&(frames.len() as u32 - 1)) {
        split_points.push(frames.len() as u32 - 1);
    }

    // 生成片段范围
    let mut segments = Vec::new();
    for i in 0..split_points.len() - 1 {
        segments.push(SegmentRange {
            start_frame: split_points[i],
            end_frame: split_points[i + 1] - 1,
        });
    }

    let original_count = segments.len();

    // 移除最后一个片段
    if segments.is_empty() {
        return Err("未检测到场景切换（相似度始终高于阈值）".to_string());
    }

    segments.pop();

    if segments.is_empty() {
        return Err(format!(
            "检测到 {} 个片段，移除最后一个后无剩余片段，跳过该视频",
            original_count
        ));
    }

    let _ = window.emit(
        "remove_ending_progress",
        serde_json::json!({
            "message": format!("识别到 {} 个片段，移除最后一个后剩余 {} 个", original_count, segments.len()),
            "percent": 60,
        }),
    );

    // 如果需要随机打乱
    if shuffle_segments {
        let mut rng = rand::thread_rng();
        segments.shuffle(&mut rng);
    }

    // 生成临时片段文件
    let _ = window.emit(
        "remove_ending_progress",
        serde_json::json!({
            "message": "正在生成临时片段...",
            "percent": 60,
        }),
    );

    let video_hash = calculate_hash(&video_path);
    let temp_dir = std::env::temp_dir()
        .join(format!("mp4handler_{}", video_hash))
        .join("segments");

    if temp_dir.exists() {
        fs::remove_dir_all(&temp_dir).map_err(|e| format!("清理临时目录失败: {}", e))?;
    }
    fs::create_dir_all(&temp_dir).map_err(|e| format!("创建临时目录失败: {}", e))?;

    let frame_timestamps = get_video_frame_timestamps(&app, &video_path).await?;
    let total_frames_count = frame_timestamps.len();

    let mut temp_segment_paths = Vec::new();

    for (idx, segment) in segments.iter().enumerate() {
        let segment_num = idx + 1;
        let temp_file = temp_dir.join(format!("segment_{}.mp4", segment_num));

        let start_idx = segment.start_frame as usize;
        let end_idx = segment.end_frame as usize;
        if start_idx >= total_frames_count || end_idx >= total_frames_count || start_idx > end_idx {
            return Err(format!("片段 {} 的帧范围无效", segment_num));
        }

        let start_time = frame_timestamps[start_idx];
        let end_time_exclusive = if end_idx + 1 < total_frames_count {
            frame_timestamps[end_idx + 1]
        } else {
            metadata.duration.max(frame_timestamps[end_idx])
        };
        let duration = (end_time_exclusive - start_time).max(0.0);

        let percent = 60 + ((segment_num as f64 / segments.len() as f64) * 20.0) as u32;
        let _ = window.emit(
            "remove_ending_progress",
            serde_json::json!({
                "message": format!("正在生成临时片段 {}/{}", segment_num, segments.len()),
                "percent": percent,
            }),
        );

        let sidecar = app
            .shell()
            .sidecar("ffmpeg")
            .map_err(|e| format!("FFmpeg 启动失败: {}", e))?;

        let output = sidecar
            .args(&[
                "-i",
                &video_path,
                "-ss",
                &start_time.to_string(),
                "-t",
                &duration.to_string(),
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
                temp_file.to_str().unwrap(),
            ])
            .output()
            .await
            .map_err(|e| format!("FFmpeg 执行失败: {}", e))?;

        if !output.status.success() {
            return Err(format!(
                "生成临时片段 {} 失败: {}",
                segment_num,
                String::from_utf8_lossy(&output.stderr)
            ));
        }

        temp_segment_paths.push(temp_file);
    }

    // 如果有新结尾视频，添加到列表
    if let Some(ending) = new_ending_video {
        if !ending.is_empty() {
            let ending_path = PathBuf::from(&ending);
            if !ending_path.exists() {
                return Err(format!("新结尾视频不存在: {}", ending));
            }
            temp_segment_paths.push(ending_path);
        }
    }

    // 检测视频兼容性
    let _ = window.emit(
        "remove_ending_progress",
        serde_json::json!({
            "message": "正在检测视频兼容性...",
            "percent": 80,
        }),
    );

    let videos_info = check_video_compatibility_for_paths(&app, &temp_segment_paths).await?;

    let (target_width, target_height) = videos_info
        .first()
        .map(|(_, info)| (info.width, info.height))
        .ok_or("无法获取目标分辨率")?;

    let filter = build_concat_filter(&videos_info, target_width, target_height)?;

    // 生成输出文件名
    let video_name = Path::new(&video_path)
        .file_stem()
        .ok_or("无法获取视频文件名")?
        .to_string_lossy();
    let output_path = PathBuf::from(&output_dir).join(format!("{}_processed.mp4", video_name));

    // 合成视频
    let _ = window.emit(
        "remove_ending_progress",
        serde_json::json!({
            "message": "正在合成视频...",
            "percent": 80,
        }),
    );

    let sidecar = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("FFmpeg 启动失败: {}", e))?;

    let mut args: Vec<String> = Vec::new();
    for video in &temp_segment_paths {
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

    // 清理临时文件
    let _ = fs::remove_dir_all(&temp_dir);

    let _ = window.emit(
        "remove_ending_progress",
        serde_json::json!({
            "message": "完成",
            "percent": 100,
        }),
    );

    Ok(format!(
        "成功处理视频，输出文件: {}",
        output_path.display()
    ))
}
