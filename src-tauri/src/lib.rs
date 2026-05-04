// 应用库入口：模块声明、全局状态定义、Tauri 应用构建
mod backup;
mod commands;
mod config;
mod import_commands;
mod db;
mod metadata;
mod utils;

use std::sync::{Arc, Mutex};

/// 全局应用状态，持有数据库的线程安全引用
pub struct AppState {
    pub db: Arc<Mutex<db::Database>>,
}

/// 初始化数据库、注册插件和命令，启动 Tauri 应用
pub fn run() {
    let db = db::Database::new().expect("Failed to initialize database");

    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
                ])
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState {
            db: Arc::new(Mutex::new(db)),
        })
        .invoke_handler(tauri::generate_handler![
            import_commands::import_images,
            import_commands::import_folder,
            commands::get_images,
            commands::get_image_detail,
            commands::delete_image,
            commands::add_tag,
            commands::remove_tag,
            commands::get_all_tags,
            commands::get_images_by_tag,
            commands::update_image_tags,
            commands::get_stats,
            commands::toggle_favorite,
            commands::get_favorites,
            commands::update_prompt,
            commands::reveal_image_in_file_manager,
            commands::reparse_image_metadata,
            commands::start_reparse_all_metadata,
            commands::get_storage_config,
            commands::set_storage_dir,
            commands::get_image_base64,
            import_commands::start_import_images,
            import_commands::start_import_folder,
            commands::get_civitai_key_status,
            commands::set_civitai_api_key,
            commands::lookup_civitai_by_hash,
            commands::open_url,
            commands::get_ai_tag_key_status,
            commands::set_ai_tag_api_key,
            commands::get_ai_tag_config,
            commands::set_ai_tag_config,
            commands::start_ai_tagging_missing_images,
            backup::export_gallery,
            backup::start_export_gallery,
            backup::import_gallery,
            backup::start_import_gallery,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
