mod commands;
mod config;
mod db;
mod metadata;
mod utils;

use std::sync::Mutex;

pub struct AppState {
    pub db: Mutex<db::Database>,
}

pub fn run() {
    let db = db::Database::new().expect("Failed to initialize database");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState {
            db: Mutex::new(db),
        })
        .invoke_handler(tauri::generate_handler![
            commands::import_images,
            commands::import_folder,
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
            commands::get_storage_config,
            commands::set_storage_dir,
            commands::get_image_base64,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
