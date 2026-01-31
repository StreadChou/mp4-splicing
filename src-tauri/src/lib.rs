mod video_processor;
mod video_frame_extractor;
mod frame_similarity;
mod downloader;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let pool_manager = video_processor::VideoPoolManager::new();  // 新增

    tauri::Builder::default()
        .manage(pool_manager)  // 新增：注册全局状态
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            video_processor::concat_videos,
            video_processor::concat_videos_with_reencode,
            video_frame_extractor::get_video_metadata,
            video_frame_extractor::extract_all_frames,
            video_frame_extractor::generate_video_segments,
            video_frame_extractor::list_mp4_files,
            video_frame_extractor::load_batch_progress,
            video_frame_extractor::save_batch_progress,
            video_frame_extractor::delete_video_file,
            video_frame_extractor::auto_split_video,
            downloader::batch_download,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
