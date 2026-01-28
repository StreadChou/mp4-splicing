use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::{Command, Stdio};
use std::io::Read;
use tauri::Emitter;
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SceneSegment {
    pub start_time: f64,
    pub end_time: f64,
}

#[derive(Debug, Clone)]
pub struct SplitConfig {
    pub similarity_threshold: f32,
}

const EXPONENTIAL_BACKOFF_BASE: f32 = 1.5;
const BACKOFF_WINDOW_SECONDS: u32 = 10;
const HISTOGRAM_BINS: usize = 256;

// 获取视频帧率
fn get_video_fps(video_path: &str) -> Result<f64, String> {
    let output = Command::new("ffprobe")
        .args(&[
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=r_frame_rate",
            "-of", "default=noprint_wrappers=1:nokey=1:noesc=1",
            video_path,
        ])
        .output()
        .map_err(|e| format!("Failed to run ffprobe: {}", e))?;

    let output_str = String::from_utf8_lossy(&output.stdout);
    let fps_str = output_str.trim();

    if fps_str.contains('/') {
        let parts: Vec<&str> = fps_str.split('/').collect();
        if parts.len() == 2 {
            let num: f64 = parts[0].parse().map_err(|_| "Failed to parse fps numerator".to_string())?;
            let den: f64 = parts[1].parse().map_err(|_| "Failed to parse fps denominator".to_string())?;
            return Ok(num / den);
        }
    }

    fps_str.parse::<f64>().map_err(|_| "Failed to parse fps".to_string())
}

// 获取视频总帧数
fn get_video_frame_count(video_path: &str) -> Result<u32, String> {
    let output = Command::new("ffprobe")
        .args(&[
            "-v", "error",
            "-select_streams", "v:0",
            "-count_packets",
            "-show_entries", "stream=nb_read_packets",
            "-of", "csv=p=0",
            video_path,
        ])
        .output()
        .map_err(|e| format!("Failed to run ffprobe: {}", e))?;

    let output_str = String::from_utf8_lossy(&output.stdout);
    output_str.trim().parse::<u32>()
        .map_err(|_| "Failed to parse frame count".to_string())
}

// 计算单帧的 RGB 直方图
fn compute_histogram(frame_data: &[u8]) -> Vec<u32> {
    let mut histogram = vec![0u32; HISTOGRAM_BINS * 3];

    for chunk in frame_data.chunks(3) {
        if chunk.len() == 3 {
            histogram[chunk[0] as usize] += 1;
            histogram[HISTOGRAM_BINS + chunk[1] as usize] += 1;
            histogram[2 * HISTOGRAM_BINS + chunk[2] as usize] += 1;
        }
    }

    histogram
}

// 计算两帧的相似度（卡方距离）
fn calculate_similarity(hist1: &[u32], hist2: &[u32]) -> f32 {
    if hist1.len() != hist2.len() {
        return 0.0;
    }

    let mut chi_square = 0.0;
    for (h1, h2) in hist1.iter().zip(hist2.iter()) {
        let h1 = *h1 as f32;
        let h2 = *h2 as f32;
        if h1 + h2 > 0.0 {
            let diff = h1 - h2;
            chi_square += (diff * diff) / (h1 + h2);
        }
    }

    1.0 - (chi_square / 1000.0).min(1.0)
}

// 指数退避搜索
fn exponential_backoff_search(
    frames: &[Vec<u32>],
    reference_frame_idx: u32,
    start_search_idx: u32,
    fps: f64,
    threshold: f32,
) -> bool {
    let window_frames = (BACKOFF_WINDOW_SECONDS as f64 * fps) as u32;
    let end_search_idx = (start_search_idx + window_frames).min(frames.len() as u32);

    let mut step = 1u32;
    let mut search_idx = start_search_idx;

    while search_idx < end_search_idx {
        if (search_idx as usize) < frames.len() {
            let similarity = calculate_similarity(&frames[reference_frame_idx as usize], &frames[search_idx as usize]);
            if similarity >= threshold {
                return true;
            }
        }

        step = ((step as f32 * EXPONENTIAL_BACKOFF_BASE) as u32).max(1);
        search_idx += step;
    }

    false
}

// 分割视频为片段列表
fn segment_video(
    frames: &[Vec<u32>],
    fps: f64,
    config: &SplitConfig,
) -> Vec<SceneSegment> {
    let mut segments = Vec::new();
    let mut current_segment_start = 0u32;
    let mut frame_idx = 0u32;

    while frame_idx < frames.len() as u32 {
        let current_idx = frame_idx as usize;

        if current_idx + 1 >= frames.len() {
            break;
        }

        let next_idx = current_idx + 1;
        let similarity = calculate_similarity(&frames[current_idx], &frames[next_idx]);

        if similarity < config.similarity_threshold {
            // 进入指数退避搜索
            let found_similar = exponential_backoff_search(
                frames,
                frame_idx,
                frame_idx + 1,
                fps,
                config.similarity_threshold,
            );

            if !found_similar {
                // 标记为片段结尾
                let segment = SceneSegment {
                    start_time: current_segment_start as f64 / fps,
                    end_time: frame_idx as f64 / fps,
                };
                segments.push(segment);
                current_segment_start = frame_idx + 1;
            }
        }

        frame_idx += 1;
    }

    // 添加最后一个片段
    if current_segment_start < frames.len() as u32 {
        let segment = SceneSegment {
            start_time: current_segment_start as f64 / fps,
            end_time: (frames.len() as u32 - 1) as f64 / fps,
        };
        segments.push(segment);
    }

    segments
}

// 提取帧数据（流式处理）
fn extract_frames_stream(
    video_path: &str,
    _fps: f64,
    total_frames: u32,
    on_progress: &dyn Fn(u32, u32),
) -> Result<Vec<Vec<u32>>, String> {
    let mut child = Command::new("ffmpeg")
        .args(&[
            "-i", video_path,
            "-f", "rawvideo",
            "-pix_fmt", "rgb24",
            "-",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to spawn ffmpeg: {}", e))?;

    let stdout = child.stdout.take().ok_or("Failed to open stdout")?;
    let mut reader = std::io::BufReader::new(stdout);

    let mut frames = Vec::new();
    let mut frame_buffer = vec![0u8; 1920 * 1080 * 3]; // 假设 1080p
    let mut frame_count = 0u32;

    loop {
        match reader.read_exact(&mut frame_buffer) {
            Ok(_) => {
                let histogram = compute_histogram(&frame_buffer);
                frames.push(histogram);
                frame_count += 1;

                if frame_count % 30 == 0 {
                    on_progress(frame_count, total_frames);
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
                break;
            }
            Err(e) => {
                return Err(format!("Failed to read frame: {}", e));
            }
        }
    }

    child.wait().map_err(|e| format!("Failed to wait for ffmpeg: {}", e))?;

    Ok(frames)
}

// 提取单个片段并转码
fn extract_segment(
    video_path: &str,
    output_path: &str,
    start_time: f64,
    end_time: f64,
) -> Result<(), String> {
    let duration = end_time - start_time;

    Command::new("ffmpeg")
        .args(&[
            "-i", video_path,
            "-ss", &start_time.to_string(),
            "-t", &duration.to_string(),
            "-c:v", "libx264",
            "-c:a", "aac",
            "-y",
            output_path,
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .map_err(|e| format!("Failed to extract segment: {}", e))?;

    Ok(())
}

// 主命令入口
#[tauri::command]
pub async fn split_videos(
    input_dir: String,
    output_dir: String,
    similarity_threshold: f32,
    _scene_detect_window: u32,
    window: tauri::Window,
) -> Result<String, String> {
    let threshold = (similarity_threshold / 100.0).max(0.0).min(1.0);
    let config = SplitConfig {
        similarity_threshold: threshold,
    };

    // 扫描输入目录中的 MP4 文件
    let mut video_files = Vec::new();
    for entry in WalkDir::new(&input_dir)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if entry.path().extension().and_then(|s| s.to_str()) == Some("mp4") {
            video_files.push(entry.path().to_path_buf());
        }
    }

    if video_files.is_empty() {
        return Err("No MP4 files found in input directory".to_string());
    }

    let total_videos = video_files.len();
    let mut total_segments = 0;

    for (video_idx, video_path) in video_files.iter().enumerate() {
        let video_name = video_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown");

        // 发送处理开始事件
        let _ = window.emit("split_progress", serde_json::json!({
            "type": "processing",
            "message": format!("Processing video {}/{}: {}", video_idx + 1, total_videos, video_name),
            "percent": ((video_idx as f32 / total_videos as f32) * 100.0) as u32,
            "videoName": video_name,
        }));

        // 获取视频信息
        let fps = get_video_fps(video_path.to_str().unwrap())?;
        let total_frames = get_video_frame_count(video_path.to_str().unwrap())?;

        // 提取帧数据
        let frames = extract_frames_stream(
            video_path.to_str().unwrap(),
            fps,
            total_frames,
            &|current, total| {
                let _ = window.emit("split_progress", serde_json::json!({
                    "type": "processing",
                    "message": format!("Extracting frames: {}/{}", current, total),
                    "percent": ((current as f32 / total as f32) * 100.0) as u32,
                    "videoName": video_name,
                }));
            },
        )?;

        // 分割视频
        let segments = segment_video(&frames, fps, &config);
        total_segments += segments.len();

        // 提取片段
        let stem = video_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("output");

        for (seg_idx, segment) in segments.iter().enumerate() {
            let output_filename = format!("{}_{}.mp4", stem, seg_idx + 1);
            let output_path = Path::new(&output_dir).join(&output_filename);

            let _ = window.emit("split_progress", serde_json::json!({
                "type": "extracting",
                "message": format!("Extracting segment {}/{}", seg_idx + 1, segments.len()),
                "percent": ((seg_idx as f32 / segments.len() as f32) * 100.0) as u32,
                "videoName": video_name,
                "segmentCount": seg_idx + 1,
            }));

            extract_segment(
                video_path.to_str().unwrap(),
                output_path.to_str().unwrap(),
                segment.start_time,
                segment.end_time,
            )?;
        }
    }

    let _ = window.emit("split_progress", serde_json::json!({
        "type": "complete",
        "message": format!("Completed! Generated {} segments", total_segments),
        "percent": 100,
    }));

    Ok(format!("Successfully split videos into {} segments", total_segments))
}
