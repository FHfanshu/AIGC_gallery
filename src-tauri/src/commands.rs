// Tauri 命令模块：前端可调用的 IPC 命令实现
// 包含图片导入、查询、删除、标签管理、收藏、Prompt 编辑等功能
use crate::db::{ImageRecord, ImageStats, TagRecord};
use crate::metadata;
use crate::utils;
use crate::AppState;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};
use walkdir::WalkDir;

/// 图片导入结果统计
#[derive(Debug, Serialize, Deserialize)]
pub struct ImportResult {
    pub success: Vec<String>,
    pub skipped: Vec<String>,
    pub errors: Vec<String>,
}

/// Core logic for importing a single image file.
/// Returns Ok(Some(hash)) on success, Ok(None) on skip, Err on error.
fn import_single_image(
    db: &Arc<Mutex<crate::db::Database>>,
    path: &Path,
    result: &mut ImportResult,
    path_str: &str,
    import_strategy: &str,
) {
    // Check if it's a supported image format
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    // 目前仅支持 PNG 格式的元数据提取
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
    // 用 SHA256 计算文件哈希，作为唯一标识和存储文件名
    let mut hasher = Sha256::new();
    hasher.update(&file_data);
    let hash = format!("{:x}", hasher.finalize());

    // Check if already imported
    if db.lock().map(|db| db.image_exists(&hash).unwrap_or(false)).unwrap_or(false) {
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
    // 将源文件复制到统一的图片存储目录，以哈希值命名防止冲突
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

    let storage_mode = if import_strategy == "hardlink_then_copy" {
        match fs::hard_link(path, &stored_path) {
            Ok(_) => "hardlink",
            Err(e) => {
                log::debug!("hardlink failed for {}: {}, falling back to copy", path_str, e);
                if let Err(e) = fs::copy(path, &stored_path) {
                    result
                        .errors
                        .push(format!("{}: Failed to copy to storage: {}", path_str, e));
                    return;
                }
                "copy"
            }
        }
    } else {
        if let Err(e) = fs::copy(path, &stored_path) {
            result
                .errors
                .push(format!("{}: Failed to copy to storage: {}", path_str, e));
            return;
        }
        "copy"
    };

    let stored_path_str = stored_path.to_string_lossy().to_string();

    // Generate thumbnail
    // 生成缩略图，失败不影响导入流程
    let thumbnails_dir = utils::paths::thumbnails_dir();
    let thumbnail_path = match utils::thumbnail::generate_thumbnail(path, &thumbnails_dir, 512) {
        Ok(p) => Some(p.to_string_lossy().to_string()),
        Err(e) => {
            // Non-fatal: log warning but continue import
            eprintln!("Warning: Failed to generate thumbnail for {}: {}", path_str, e);
            None
        }
    };

    let db = match db.lock() {
        Ok(db) => db,
        Err(e) => {
            result.errors.push(format!("{}: {}", path_str, e));
            return;
        }
    };

    // 写入数据库记录
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
        storage_mode,
    ) {
        Ok(_id) => result.success.push(path_str.to_string()),
        Err(e) => result.errors.push(format!("{}: {}", path_str, e)),
    }
}

/// 同步导入指定文件列表中的图片
#[tauri::command]
pub fn import_images(
    state: State<AppState>,
    file_paths: Vec<String>,
) -> Result<ImportResult, String> {
    let mut result = ImportResult {
        success: Vec::new(),
        skipped: Vec::new(),
        errors: Vec::new(),
    };

    log::info!("import_images: {} files to process", file_paths.len());
    for path_str in &file_paths {
        let path = Path::new(path_str);
        import_single_image(&state.db, path, &mut result, path_str);
    }
    log::info!("import_images done: {} success, {} skipped, {} errors",
        result.success.len(), result.skipped.len(), result.errors.len());

    Ok(result)
}

/// 同步扫描文件夹，递归导入其中所有 PNG 图片
#[tauri::command]
pub fn import_folder(
    state: State<AppState>,
    folder_path: String,
) -> Result<ImportResult, String> {
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
        import_single_image(&state.db, path, &mut result, &path_str);
    }

    log::info!("import_folder done: {} success, {} skipped, {} errors",
        result.success.len(), result.skipped.len(), result.errors.len());

    Ok(result)
}

/// 后台线程导入文件列表，通过事件推送进度
#[tauri::command]
pub fn start_import_images(
    app: AppHandle,
    state: State<AppState>,
    file_paths: Vec<String>,
) -> Result<(), String> {
    let db = state.db.clone();
    // 在新线程中执行导入，避免阻塞前端
    std::thread::spawn(move || {
        let mut result = ImportResult {
            success: Vec::new(),
            skipped: Vec::new(),
            errors: Vec::new(),
        };
        let total = file_paths.len();
        // 发送初始进度事件
        let _ = app.emit("import-progress", serde_json::json!({
            "done": 0,
            "total": total,
            "finished": false,
        }));

        for (idx, path_str) in file_paths.iter().enumerate() {
            let path = Path::new(path_str);
            import_single_image(&db, path, &mut result, path_str);
            // 每导入一张发送一次进度更新
            let _ = app.emit("import-progress", serde_json::json!({
                "done": idx + 1,
                "total": total,
                "finished": false,
            }));
        }

        // 导入完成，发送结果事件
        let _ = app.emit("import-finished", &result);
        log::info!("background import_images done: {} success, {} skipped, {} errors",
            result.success.len(), result.skipped.len(), result.errors.len());
    });
    Ok(())
}

/// 后台线程扫描文件夹并导入 PNG 图片，通过事件推送进度
#[tauri::command]
pub fn start_import_folder(
    app: AppHandle,
    state: State<AppState>,
    folder_path: String,
) -> Result<(), String> {
    let db = state.db.clone();
    // 在新线程中执行，先收集文件列表再逐个导入
    std::thread::spawn(move || {
        // 先递归收集所有 PNG 文件路径
        let files: Vec<String> = WalkDir::new(&folder_path)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
            .filter_map(|e| {
                let path = e.path();
                let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
                (ext == "png").then(|| path.to_string_lossy().to_string())
            })
            .collect();

        let mut result = ImportResult {
            success: Vec::new(),
            skipped: Vec::new(),
            errors: Vec::new(),
        };
        let total = files.len();
        let _ = app.emit("import-progress", serde_json::json!({
            "done": 0,
            "total": total,
            "finished": false,
        }));

        for (idx, path_str) in files.iter().enumerate() {
            let path = Path::new(path_str);
            import_single_image(&db, path, &mut result, path_str);
            let _ = app.emit("import-progress", serde_json::json!({
                "done": idx + 1,
                "total": total,
                "finished": false,
            }));
        }

        let _ = app.emit("import-finished", &result);
        log::info!("background import_folder done: {} success, {} skipped, {} errors",
            result.success.len(), result.skipped.len(), result.errors.len());
    });
    Ok(())
}

/// 分页查询图片列表，支持关键词搜索
#[tauri::command]
pub fn get_images(
    state: State<AppState>,
    offset: Option<i64>,
    limit: Option<i64>,
    search: Option<String>,
) -> Result<Vec<ImageRecord>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let imgs = db.get_images(
        offset.unwrap_or(0),
        limit.unwrap_or(50),
        search.as_deref(),
    )?;
    log::debug!("get_images: offset={:?} limit={:?} search={:?} -> {} results",
        offset, limit, search, imgs.len());
    Ok(imgs)
}

/// 根据 ID 获取图片详情
#[tauri::command]
pub fn get_image_detail(
    state: State<AppState>,
    id: i64,
) -> Result<ImageRecord, String> {
    log::debug!("get_image_detail: id={}", id);
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_image_by_id(id)
}

/// 删除指定图片记录及其关联数据
#[tauri::command]
pub fn delete_image(
    state: State<AppState>,
    id: i64,
) -> Result<(), String> {
    log::info!("delete_image: id={}", id);
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.delete_image(id)
}

/// 创建新标签，可指定颜色
#[tauri::command]
pub fn add_tag(
    state: State<AppState>,
    name: String,
    color: Option<String>,
) -> Result<i64, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.add_tag(&name, color.as_deref().unwrap_or("#6366f1"))
}

/// 删除标签
#[tauri::command]
pub fn remove_tag(
    state: State<AppState>,
    tag_id: i64,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.remove_tag(tag_id)
}

/// 获取所有标签列表
#[tauri::command]
pub fn get_all_tags(
    state: State<AppState>,
) -> Result<Vec<TagRecord>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_all_tags()
}

/// 按标签名查询关联的图片，支持分页
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

/// 更新图片关联的标签
#[tauri::command]
pub fn update_image_tags(
    state: State<AppState>,
    image_id: i64,
    tag_ids: Vec<i64>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.update_image_tags(image_id, &tag_ids)
}

/// 获取图片库统计信息（总数、标签数等）
#[tauri::command]
pub fn get_stats(
    state: State<AppState>,
) -> Result<ImageStats, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_stats()
}

/// 切换图片收藏状态，返回新的收藏状态
#[tauri::command]
pub fn toggle_favorite(
    state: State<AppState>,
    image_id: i64,
) -> Result<bool, String> {
    log::info!("toggle_favorite: image_id={}", image_id);
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.toggle_favorite(image_id)
}

/// 分页获取收藏图片列表
#[tauri::command]
pub fn get_favorites(
    state: State<AppState>,
    offset: Option<i64>,
    limit: Option<i64>,
) -> Result<Vec<ImageRecord>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_favorites(offset.unwrap_or(0), limit.unwrap_or(50))
}

/// 更新图片的正向/反向 Prompt 文本
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

// --- 存储配置相关命令 ---

/// 存储配置信息，包含用户自定义路径和最终解析路径
#[derive(Serialize, Deserialize)]
pub struct StorageConfig {
    pub storage_dir: Option<String>,
    pub resolved_dir: String,
    pub import_strategy: String,
}

/// 获取当前存储配置
#[tauri::command]
pub fn get_storage_config() -> Result<StorageConfig, String> {
    let cfg = crate::config::load_config();
    let resolved = crate::config::resolve_storage_dir(&cfg);
    std::fs::create_dir_all(resolved.join("images")).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(resolved.join("thumbnails")).map_err(|e| e.to_string())?;
    Ok(StorageConfig {
        storage_dir: cfg.storage_dir,
        resolved_dir: resolved.to_string_lossy().to_string(),
        import_strategy: cfg.import_strategy,
    })
}

/// 设置存储目录，保存配置并确保子目录存在
#[tauri::command]
pub fn set_storage_dir(dir: Option<String>, import_strategy: Option<String>) -> Result<StorageConfig, String> {
    let mut cfg = crate::config::load_config();
    cfg.storage_dir = dir;
    if let Some(strategy) = import_strategy {
        if strategy == "copy" || strategy == "hardlink_then_copy" {
            cfg.import_strategy = strategy;
        }
    }
    crate::config::save_config(&cfg)?;
    let resolved = crate::config::resolve_storage_dir(&cfg);
    // Ensure directories exist
    // 确保 images 和 thumbnails 子目录存在
    std::fs::create_dir_all(resolved.join("images")).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(resolved.join("thumbnails")).map_err(|e| e.to_string())?;
    Ok(StorageConfig {
        storage_dir: cfg.storage_dir,
        resolved_dir: resolved.to_string_lossy().to_string(),
        import_strategy: cfg.import_strategy,
    })
}

/// Return image file as base64 data URI for reliable display in webview.
/// Reads stored_path (or thumbnail_path) from DB, loads file, returns base64.
#[tauri::command]
pub fn get_image_base64(state: State<AppState>, image_id: i64, use_thumbnail: bool) -> Result<String, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let img = db.get_image_by_id(image_id)?;
    drop(db); // 提前释放锁，避免持有锁期间做文件 IO

    // 按优先级构建候选路径列表
    let mut candidates: Vec<&str> = Vec::new();
    if use_thumbnail {
        if let Some(path) = img.thumbnail_path.as_deref() {
            candidates.push(path);
        }
    }
    if let Some(path) = img.stored_path.as_deref() {
        candidates.push(path);
    }
    candidates.push(&img.file_path); // 最后回退到原始路径

    // 依次尝试候选路径，找到第一个存在的文件
    for file_path in candidates {
        let path = std::path::Path::new(file_path);
        if !path.exists() {
            log::warn!("image file candidate not found: {}", file_path);
            continue;
        }

        let data = std::fs::read(path).map_err(|e| e.to_string())?;
        let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &data);
        let mime = if file_path.ends_with(".jpg") || file_path.ends_with(".jpeg") {
            "image/jpeg"
        } else {
            "image/png"
        };
        return Ok(format!("data:{};base64,{}", mime, b64));
    }

    Err(format!("No existing image file found for image id {}", image_id))
}
