use reqwest::Client;
use tokio::fs::File;
use tokio::io::AsyncWriteExt;
use futures_util::StreamExt;
use std::path::Path;
use tauri::{AppHandle, Manager, Emitter};

#[derive(serde::Serialize, Clone)]
struct DownloadProgress {
    url: String,
    progress: u32,
    speed: String,
    status: String,
}

#[tauri::command]
pub async fn batch_download(
    app: AppHandle,
    urls: Vec<String>,
    output_dir: String,
    max_concurrent: usize,
) -> Result<String, String> {
    let window = app.get_webview_window("main")
        .ok_or("无法获取窗口")?;

    // 创建输出目录
    tokio::fs::create_dir_all(&output_dir).await
        .map_err(|e| format!("创建目录失败: {}", e))?;

    // 创建 HTTP 客户端
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| format!("创建客户端失败: {}", e))?;

    // 使用 tokio 并发下载
    let mut tasks = Vec::new();
    let semaphore = std::sync::Arc::new(tokio::sync::Semaphore::new(max_concurrent));

    for url in urls {
        let client = client.clone();
        let output_dir = output_dir.clone();
        let window = window.clone();
        let permit = semaphore.clone().acquire_owned().await.unwrap();

        let task = tokio::spawn(async move {
            let result = download_single_file(
                &client,
                &url,
                &output_dir,
                window.clone()
            ).await;

            drop(permit);
            result
        });

        tasks.push(task);
    }

    // 等待所有下载完成
    let mut success_count = 0;
    let mut failed_count = 0;

    for task in tasks {
        match task.await {
            Ok(Ok(_)) => success_count += 1,
            _ => failed_count += 1,
        }
    }

    Ok(format!("下载完成！成功: {}, 失败: {}", success_count, failed_count))
}

async fn download_single_file(
    client: &Client,
    url: &str,
    output_dir: &str,
    window: tauri::WebviewWindow,
) -> Result<(), String> {
    // 发送初始状态
    let _ = window.emit("download_progress", DownloadProgress {
        url: url.to_string(),
        progress: 0,
        speed: "0 MB/s".to_string(),
        status: "downloading".to_string(),
    });

    // 提取文件名
    let filename = extract_filename(url);
    let output_path = Path::new(output_dir).join(&filename);

    // 发起 HTTP 请求
    let response = client.get(url)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    if !response.status().is_success() {
        let _ = window.emit("download_progress", DownloadProgress {
            url: url.to_string(),
            progress: 0,
            speed: "0 MB/s".to_string(),
            status: "failed".to_string(),
        });
        return Err(format!("HTTP 错误: {}", response.status()));
    }

    let total_size = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut stream = response.bytes_stream();

    // 创建文件
    let mut file = File::create(&output_path).await
        .map_err(|e| format!("创建文件失败: {}", e))?;

    let start_time = std::time::Instant::now();

    // 流式下载
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("下载数据失败: {}", e))?;
        file.write_all(&chunk).await
            .map_err(|e| format!("写入文件失败: {}", e))?;

        downloaded += chunk.len() as u64;

        // 计算进度和速度
        let progress = if total_size > 0 {
            ((downloaded as f64 / total_size as f64) * 100.0) as u32
        } else {
            0
        };

        let elapsed = start_time.elapsed().as_secs_f64();
        let speed = if elapsed > 0.0 {
            format!("{:.2} MB/s", (downloaded as f64 / 1024.0 / 1024.0) / elapsed)
        } else {
            "0 MB/s".to_string()
        };

        // 每下载 1MB 发送一次进度
        if downloaded % (1024 * 1024) < chunk.len() as u64 {
            let _ = window.emit("download_progress", DownloadProgress {
                url: url.to_string(),
                progress,
                speed,
                status: "downloading".to_string(),
            });
        }
    }

    file.flush().await
        .map_err(|e| format!("刷新文件失败: {}", e))?;

    // 发送完成状态
    let _ = window.emit("download_progress", DownloadProgress {
        url: url.to_string(),
        progress: 100,
        speed: "0 MB/s".to_string(),
        status: "completed".to_string(),
    });

    Ok(())
}

fn extract_filename(url: &str) -> String {
    url.split('/')
        .last()
        .and_then(|s| s.split('?').next())
        .unwrap_or("download.mp4")
        .to_string()
}
