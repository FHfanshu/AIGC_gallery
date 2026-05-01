use crate::db::{ImageRecord, ImageStats, TagRecord};
use crate::metadata;
use crate::utils;
use crate::AppState;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;
use tauri::State;
use walkdir::WalkDir;

#[derive(Debug, Serialize, Deserialize)]
pub struct ImportResult {
    pub success: Vec<String>,
    pub skipped: Vec<String>,
    pub errors: Vec<String>,
}

/// Core logic for importing a single image file.
/// Returns Ok(Some(hash)) on success, Ok(None) on skip, Err on error.
fn import_single_image(
    db: &crate::db::Database,
    path: &Path,
    result: &mut ImportResult,
    path_str: &str,
) {
    // Check if it's a supported image format
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    if ext != "png" {
        result
            .skipped
            .push(format!("{}: Not PNG, metadata extraction not supported", path_str));
        return;
    }

    // Read file data
    let file_data = match fs::read(path) {
        Ok(data) => data,
        Err(e) => {
            result.errors.push(format!("{}: {}", path_str, e));
            return;
        }
    };

    // Compute file hash
    let mut hasher = Sha256::new();
    hasher.update(&file_data);
    let hash = format!("{:x}", hasher.finalize());

    // Check if already imported
    if db.image_exists(&hash).unwrap_or(false) {
        result
            .skipped
            .push(format!("{}: Already imported", path_str));
        return;
    }

    // Parse metadata
    let meta = match metadata::parse_png_metadata(path) {
        Ok(m) => m,
        Err(e) => {
            result
                .skipped
                .push(format!("{}: {}", path_str, e));
            return;
        }
    };

    // Get dimensions
    let (width, height) = metadata::get_image_dimensions(path).unwrap_or((0, 0));

    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    let metadata_json = serde_json::to_string(&meta).unwrap_or_default();

    // Determine source type from metadata
    let source_type = meta.source.clone();

    // Copy file to images_dir
    let images_dir = utils::paths::images_dir();
    let ext_str = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png");
    let stored_filename = format!("{}.{}", hash, ext_str);
    let stored_path = images_dir.join(&stored_filename);

    if let Err(e) = fs::create_dir_all(&images_dir) {
        result
            .errors
            .push(format!("{}: Failed to create images dir: {}", path_str, e));
        return;
    }

    if let Err(e) = fs::copy(path, &stored_path) {
        result
            .errors
            .push(format!("{}: Failed to copy to storage: {}", path_str, e));
        return;
    }

    let stored_path_str = stored_path.to_string_lossy().to_string();

    // Generate thumbnail
    let thumbnails_dir = utils::paths::thumbnails_dir();
    let thumbnail_path = match utils::thumbnail::generate_thumbnail(path, &thumbnails_dir, 512) {
        Ok(p) => Some(p.to_string_lossy().to_string()),
        Err(e) => {
            // Non-fatal: log warning but continue import
            eprintln!("Warning: Failed to generate thumbnail for {}: {}", path_str, e);
            None
        }
    };

    match db.insert_image(
        path_str,
        &file_name,
        &hash,
        width,
        height,
        &meta.prompt,
        &meta.negative_prompt,
        &metadata_json,
        &source_type,
        Some(&stored_path_str),
        thumbnail_path.as_deref(),
    ) {
        Ok(_id) => result.success.push(path_str.to_string()),
        Err(e) => result.errors.push(format!("{}: {}", path_str, e)),
    }
}

#[tauri::command]
pub fn import_images(
    state: State<AppState>,
    file_paths: Vec<String>,
) -> Result<ImportResult, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut result = ImportResult {
        success: Vec::new(),
        skipped: Vec::new(),
        errors: Vec::new(),
    };

    for path_str in &file_paths {
        let path = Path::new(path_str);
        import_single_image(&db, path, &mut result, path_str);
    }

    Ok(result)
}

#[tauri::command]
pub fn import_folder(
    state: State<AppState>,
    folder_path: String,
) -> Result<ImportResult, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut result = ImportResult {
        success: Vec::new(),
        skipped: Vec::new(),
        errors: Vec::new(),
    };

    for entry in WalkDir::new(&folder_path)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_file() {
            continue;
        }

        let path = entry.path();
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();

        if ext != "png" {
            continue;
        }

        let path_str = path.to_string_lossy().to_string();
        import_single_image(&db, path, &mut result, &path_str);
    }

    Ok(result)
}

#[tauri::command]
pub fn get_images(
    state: State<AppState>,
    offset: Option<i64>,
    limit: Option<i64>,
    search: Option<String>,
) -> Result<Vec<ImageRecord>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_images(
        offset.unwrap_or(0),
        limit.unwrap_or(50),
        search.as_deref(),
    )
}

#[tauri::command]
pub fn get_image_detail(
    state: State<AppState>,
    id: i64,
) -> Result<ImageRecord, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_image_by_id(id)
}

#[tauri::command]
pub fn delete_image(
    state: State<AppState>,
    id: i64,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.delete_image(id)
}

#[tauri::command]
pub fn add_tag(
    state: State<AppState>,
    name: String,
    color: Option<String>,
) -> Result<i64, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.add_tag(&name, color.as_deref().unwrap_or("#6366f1"))
}

#[tauri::command]
pub fn remove_tag(
    state: State<AppState>,
    tag_id: i64,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.remove_tag(tag_id)
}

#[tauri::command]
pub fn get_all_tags(
    state: State<AppState>,
) -> Result<Vec<TagRecord>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_all_tags()
}

#[tauri::command]
pub fn get_images_by_tag(
    state: State<AppState>,
    tag_name: String,
    offset: Option<i64>,
    limit: Option<i64>,
) -> Result<Vec<ImageRecord>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_images_by_tag(&tag_name, offset.unwrap_or(0), limit.unwrap_or(50))
}

#[tauri::command]
pub fn update_image_tags(
    state: State<AppState>,
    image_id: i64,
    tag_ids: Vec<i64>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.update_image_tags(image_id, &tag_ids)
}

#[tauri::command]
pub fn get_stats(
    state: State<AppState>,
) -> Result<ImageStats, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_stats()
}

#[tauri::command]
pub fn toggle_favorite(
    state: State<AppState>,
    image_id: i64,
) -> Result<bool, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.toggle_favorite(image_id)
}

#[tauri::command]
pub fn get_favorites(
    state: State<AppState>,
    offset: Option<i64>,
    limit: Option<i64>,
) -> Result<Vec<ImageRecord>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_favorites(offset.unwrap_or(0), limit.unwrap_or(50))
}

#[tauri::command]
pub fn update_prompt(
    state: State<AppState>,
    image_id: i64,
    positive_prompt: String,
    negative_prompt: String,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.update_prompt(image_id, &positive_prompt, &negative_prompt)
}

// --- Storage config commands ---

#[derive(Serialize, Deserialize)]
pub struct StorageConfig {
    pub storage_dir: Option<String>,
    pub resolved_dir: String,
}

#[tauri::command]
pub fn get_storage_config() -> Result<StorageConfig, String> {
    let cfg = crate::config::load_config();
    let resolved = crate::config::resolve_storage_dir(&cfg);
    Ok(StorageConfig {
        storage_dir: cfg.storage_dir,
        resolved_dir: resolved.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn set_storage_dir(dir: Option<String>) -> Result<StorageConfig, String> {
    let mut cfg = crate::config::load_config();
    cfg.storage_dir = dir;
    crate::config::save_config(&cfg)?;
    let resolved = crate::config::resolve_storage_dir(&cfg);
    // Ensure directories exist
    std::fs::create_dir_all(resolved.join("images")).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(resolved.join("thumbnails")).map_err(|e| e.to_string())?;
    Ok(StorageConfig {
        storage_dir: cfg.storage_dir,
        resolved_dir: resolved.to_string_lossy().to_string(),
    })
}

/// Return image file as base64 data URI for reliable display in webview.
/// Reads stored_path (or thumbnail_path) from DB, loads file, returns base64.
#[tauri::command]
pub fn get_image_base64(state: State<AppState>, image_id: i64, use_thumbnail: bool) -> Result<String, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let img = db.get_image_by_id(image_id)?;

    // Pick the path: prefer thumbnail if requested, then stored_path, then file_path
    let file_path = if use_thumbnail {
        img.thumbnail_path.as_deref().unwrap_or(img.stored_path.as_deref().unwrap_or(&img.file_path))
    } else {
        img.stored_path.as_deref().unwrap_or(&img.file_path)
    };

    let path = std::path::Path::new(file_path);
    if !path.exists() {
        return Err(format!("File not found: {}", file_path));
    }

    let data = std::fs::read(path).map_err(|e| e.to_string())?;
    let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &data);

    let mime = if file_path.ends_with(".jpg") || file_path.ends_with(".jpeg") {
        "image/jpeg"
    } else {
        "image/png"
    };

    Ok(format!("data:{};base64,{}", mime, b64))
}
