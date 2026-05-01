use std::path::PathBuf;

use crate::config;

/// Base app data directory for config and DB (%APPDATA%/aigc-gallery)
pub fn app_data_dir() -> PathBuf {
    dirs_next::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("aigc-gallery")
}

/// DB always lives in app_data_dir
pub fn db_path() -> PathBuf {
    app_data_dir().join("gallery.db")
}

/// Resolved storage root (from config or default to exe_dir/gallery-data)
fn storage_root() -> PathBuf {
    let cfg = config::load_config();
    config::resolve_storage_dir(&cfg)
}

/// Images directory under storage root
pub fn images_dir() -> PathBuf {
    storage_root().join("images")
}

/// Thumbnails directory under storage root
pub fn thumbnails_dir() -> PathBuf {
    storage_root().join("thumbnails")
}
