// Tauri 命令模块：前端可调用的 IPC 命令实现
// 包含图片导入、查询、删除、标签管理、收藏、Prompt 编辑等功能
use crate::db::{ImageRecord, ImageStats, NewImageRecord, TagRecord};
use crate::metadata;
use crate::utils;
use crate::AppState;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};
use walkdir::WalkDir;

/// 图片导入结果统计
#[derive(Debug, Serialize, Deserialize)]
pub struct ImportResult {
    pub success: Vec<String>,
    pub skipped: Vec<String>,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone)]
struct ImportContext {
    images_dir: PathBuf,
    thumbnails_dir: PathBuf,
    import_strategy: String,
}

fn empty_import_result() -> ImportResult {
    ImportResult { success: Vec::new(), skipped: Vec::new(), errors: Vec::new() }
}

/// 使用流式读取计算文件哈希，避免为大 PNG 一次性分配完整文件内存。
fn compute_file_hash(path: &Path) -> Result<String, String> {
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 1024 * 1024];
    loop {
        let n = reader.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 { break; }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn prepare_import_context(import_strategy: String) -> Result<ImportContext, String> {
    let cfg = crate::config::load_config();
    let root = crate::config::resolve_storage_dir(&cfg);
    let images_dir = root.join("images");
    let thumbnails_dir = root.join("thumbnails");
    fs::create_dir_all(&images_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&thumbnails_dir).map_err(|e| e.to_string())?;
    Ok(ImportContext { images_dir, thumbnails_dir, import_strategy })
}

fn thumbnail_path_for(stored_path: &Path, thumbnails_dir: &Path) -> PathBuf {
    let stem = stored_path.file_stem().and_then(|s| s.to_str()).unwrap_or("image");
    thumbnails_dir.join(format!("{}_thumb.jpg", stem))
}

fn spawn_thumbnail_generation(app: AppHandle, items: Vec<(PathBuf, PathBuf)>) {
    if items.is_empty() { return; }
    std::thread::spawn(move || {
        let total = items.len();
        for (idx, (source, dest)) in items.into_iter().enumerate() {
            if !dest.exists() {
                if let Err(e) = utils::thumbnail::generate_thumbnail_to_path(&source, &dest, 512) {
                    log::warn!("thumbnail generation failed for {}: {}", source.display(), e);
                }
            }
            if idx + 1 == total || (idx + 1) % 10 == 0 {
                let _ = app.emit("thumbnail-progress", serde_json::json!({
                    "done": idx + 1,
                    "total": total,
                    "finished": idx + 1 == total,
                }));
            }
        }
        let _ = app.emit("thumbnails-finished", serde_json::json!({ "total": total }));
    });
}

/// 准备单张图片导入数据：完成 hash、metadata、文件入库目录复制，但不生成缩略图、不写 DB。
fn prepare_single_image(
    db: &Arc<Mutex<crate::db::Database>>,
    path: &Path,
    result: &mut ImportResult,
    path_str: &str,
    ctx: &ImportContext,
) -> Option<(NewImageRecord, PathBuf, PathBuf)> {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    if ext != "png" {
        result.skipped.push(format!("{}: Not PNG, metadata extraction not supported", path_str));
        return None;
    }

    let hash = match compute_file_hash(path) {
        Ok(hash) => hash,
        Err(e) => {
            result.errors.push(format!("{}: {}", path_str, e));
            return None;
        }
    };

    if db.lock().map(|db| db.image_exists(&hash).unwrap_or(false)).unwrap_or(false) {
        result.skipped.push(format!("{}: Already imported", path_str));
        return None;
    }

    let meta = match metadata::parse_png_metadata(path) {
        Ok(m) => m,
        Err(e) => {
            result.skipped.push(format!("{}: {}", path_str, e));
            return None;
        }
    };
    let (width, height) = if meta.width.unwrap_or(0) > 0 && meta.height.unwrap_or(0) > 0 {
        (meta.width.unwrap_or(0), meta.height.unwrap_or(0))
    } else {
        metadata::get_image_dimensions(path).unwrap_or((0, 0))
    };

    let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("unknown").to_string();
    let metadata_json = serde_json::to_string(&meta).unwrap_or_default();
    let source_type = meta.source.clone();
    let stored_filename = format!("{}.{}", hash, ext);
    let stored_path = ctx.images_dir.join(stored_filename);

    let storage_mode = if ctx.import_strategy == "hardlink_then_copy" {
        match fs::hard_link(path, &stored_path) {
            Ok(_) => "hardlink",
            Err(e) => {
                log::debug!("hardlink failed for {}: {}, falling back to copy", path_str, e);
                if stored_path.exists() {
                    log::debug!("stored file already exists for {}, reusing {}", path_str, stored_path.display());
                } else if let Err(e) = fs::copy(path, &stored_path) {
                    result.errors.push(format!("{}: Failed to copy to storage: {}", path_str, e));
                    return None;
                }
                "copy"
            }
        }
    } else {
        if stored_path.exists() {
            log::debug!("stored file already exists for {}, reusing {}", path_str, stored_path.display());
        } else if let Err(e) = fs::copy(path, &stored_path) {
            result.errors.push(format!("{}: Failed to copy to storage: {}", path_str, e));
            return None;
        }
        "copy"
    }.to_string();

    let thumbnail_path = thumbnail_path_for(&stored_path, &ctx.thumbnails_dir);
    let insert = NewImageRecord {
        file_path: path_str.to_string(),
        file_name,
        file_hash: hash,
        width,
        height,
        prompt: meta.prompt,
        negative_prompt: meta.negative_prompt,
        metadata_json,
        source_type,
        stored_path: stored_path.to_string_lossy().to_string(),
        storage_mode,
        thumbnail_path: thumbnail_path.to_string_lossy().to_string(),
    };
    Some((insert, stored_path, thumbnail_path))
}

fn import_prepared_batch(
    db: &Arc<Mutex<crate::db::Database>>,
    pending: &[NewImageRecord],
    result: &mut ImportResult,
) {
    if pending.is_empty() { return; }
    let db = match db.lock() {
        Ok(db) => db,
        Err(e) => {
            for item in pending {
                result.errors.push(format!("{}: {}", item.file_path, e));
            }
            return;
        }
    };
    match db.insert_images_batch(pending) {
        Ok(inserted) => result.success.extend(inserted),
        Err(e) => {
            log::error!("batch insert failed: {}", e);
            for item in pending {
                result.errors.push(format!("{}: {}", item.file_path, e));
            }
        }
    }
}

fn should_emit_progress(idx: usize, total: usize, last_emit: &mut Instant) -> bool {
    if idx + 1 == total || (idx + 1) % 10 == 0 || last_emit.elapsed() >= Duration::from_millis(200) {
        *last_emit = Instant::now();
        return true;
    }
    false
}

fn collect_png_files(folder_path: &str) -> Vec<String> {
    WalkDir::new(folder_path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| {
            let path = e.path();
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
            (ext == "png").then(|| path.to_string_lossy().to_string())
        })
        .collect()
}

fn import_files_batch(
    app: &AppHandle,
    db: &Arc<Mutex<crate::db::Database>>,
    file_paths: Vec<String>,
    import_strategy: Option<String>,
) -> Result<ImportResult, String> {
    let cfg = crate::config::load_config();
    let strategy = import_strategy.unwrap_or(cfg.import_strategy);
    let ctx = prepare_import_context(strategy)?;
    let total = file_paths.len();
    let mut result = empty_import_result();
    let mut pending = Vec::new();
    let mut thumbnails = Vec::new();
    let mut last_emit = Instant::now();

    let _ = app.emit("import-progress", serde_json::json!({
        "done": 0,
        "total": total,
        "finished": false,
    }));

    for (idx, path_str) in file_paths.iter().enumerate() {
        let path = Path::new(path_str);
        if let Some((insert, stored_path, thumb_path)) = prepare_single_image(db, path, &mut result, path_str, &ctx) {
            pending.push(insert);
            thumbnails.push((stored_path, thumb_path));
        }
        if should_emit_progress(idx, total, &mut last_emit) {
            let _ = app.emit("import-progress", serde_json::json!({
                "done": idx + 1,
                "total": total,
                "finished": false,
            }));
        }
    }

    import_prepared_batch(db, &pending, &mut result);
    spawn_thumbnail_generation(app.clone(), thumbnails);
    Ok(result)
}

/// 同步导入指定文件列表中的图片
#[tauri::command]
pub fn import_images(
    app: AppHandle,
    state: State<AppState>,
    file_paths: Vec<String>,
) -> Result<ImportResult, String> {
    log::info!("import_images: {} files to process", file_paths.len());
    let result = import_files_batch(&app, &state.db, file_paths, None)?;
    log::info!("import_images done: {} success, {} skipped, {} errors",
        result.success.len(), result.skipped.len(), result.errors.len());
    Ok(result)
}

/// 同步扫描文件夹，递归导入其中所有 PNG 图片
#[tauri::command]
pub fn import_folder(
    app: AppHandle,
    state: State<AppState>,
    folder_path: String,
) -> Result<ImportResult, String> {
    let files = collect_png_files(&folder_path);
    let result = import_files_batch(&app, &state.db, files, None)?;
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
    import_strategy: Option<String>,
) -> Result<(), String> {
    let db = state.db.clone();
    std::thread::spawn(move || {
        let total = file_paths.len();
        let result = match import_files_batch(&app, &db, file_paths, import_strategy) {
            Ok(result) => result,
            Err(e) => ImportResult { success: Vec::new(), skipped: Vec::new(), errors: vec![e] },
        };
        let _ = app.emit("import-progress", serde_json::json!({
            "done": total,
            "total": total,
            "finished": true,
        }));
        let _ = app.emit("import-finished", &result);
        log::info!("background import_images done: {} success, {} skipped, {} errors",
            result.success.len(), result.skipped.len(), result.errors.len());
        if !result.errors.is_empty() {
            log::error!("background import_images errors: {}", result.errors.join(" | "));
        }
    });
    Ok(())
}

/// 后台线程扫描文件夹并导入 PNG 图片，通过事件推送进度
#[tauri::command]
pub fn start_import_folder(
    app: AppHandle,
    state: State<AppState>,
    folder_path: String,
    import_strategy: Option<String>,
) -> Result<(), String> {
    let db = state.db.clone();
    std::thread::spawn(move || {
        let files = collect_png_files(&folder_path);
        let total = files.len();
        let result = match import_files_batch(&app, &db, files, import_strategy) {
            Ok(result) => result,
            Err(e) => ImportResult { success: Vec::new(), skipped: Vec::new(), errors: vec![e] },
        };
        let _ = app.emit("import-progress", serde_json::json!({
            "done": total,
            "total": total,
            "finished": true,
        }));
        let _ = app.emit("import-finished", &result);
        log::info!("background import_folder done: {} success, {} skipped, {} errors",
            result.success.len(), result.skipped.len(), result.errors.len());
        if !result.errors.is_empty() {
            log::error!("background import_folder errors: {}", result.errors.join(" | "));
        }
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

const CIVITAI_SERVICE: &str = "aigc-gallery";
const CIVITAI_KEY_USER: &str = "civitai-api-key";

#[derive(Debug, Serialize, Deserialize)]
pub struct CivitaiKeyStatus {
    pub has_key: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CivitaiLookupResult {
    pub model_version_id: Option<i64>,
    pub model_id: Option<i64>,
    pub version_name: Option<String>,
    pub model_name: Option<String>,
    pub model_type: Option<String>,
    pub nsfw: Option<serde_json::Value>,
    pub trained_words: Vec<String>,
    pub raw: serde_json::Value,
}

/// 获取 Civitai API key 是否已保存在系统凭据库中。
#[tauri::command]
pub fn get_civitai_key_status() -> Result<CivitaiKeyStatus, String> {
    let entry = keyring::Entry::new(CIVITAI_SERVICE, CIVITAI_KEY_USER).map_err(|e| e.to_string())?;
    Ok(CivitaiKeyStatus {
        has_key: entry.get_password().map(|s| !s.is_empty()).unwrap_or(false),
    })
}

/// 将 Civitai API key 保存到系统凭据库；空字符串会删除现有 key。
#[tauri::command]
pub fn set_civitai_api_key(api_key: String) -> Result<CivitaiKeyStatus, String> {
    let entry = keyring::Entry::new(CIVITAI_SERVICE, CIVITAI_KEY_USER).map_err(|e| e.to_string())?;
    let trimmed = api_key.trim();
    if trimmed.is_empty() {
        let _ = entry.delete_credential();
        return Ok(CivitaiKeyStatus { has_key: false });
    }
    entry.set_password(trimmed).map_err(|e| e.to_string())?;
    Ok(CivitaiKeyStatus { has_key: true })
}

/// 按模型文件 hash 查询 Civitai 模型版本信息。
#[tauri::command]
pub fn lookup_civitai_by_hash(hash: String) -> Result<Option<CivitaiLookupResult>, String> {
    let clean_hash = hash.trim().trim_start_matches("0x").to_lowercase();
    if clean_hash.is_empty() || !clean_hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("Invalid hash".to_string());
    }

    let entry = keyring::Entry::new(CIVITAI_SERVICE, CIVITAI_KEY_USER).map_err(|e| e.to_string())?;
    let api_key = entry.get_password().ok().filter(|s| !s.trim().is_empty());
    let cfg = crate::config::load_config();
    let base_url = crate::config::normalize_civitai_base_url(&cfg.civitai_base_url);
    let url = format!("{}/api/v1/model-versions/by-hash/{}", base_url, clean_hash);
    let client = reqwest::blocking::Client::builder()
        .user_agent("AIGC Gallery/0.1.0")
        .build()
        .map_err(|e| e.to_string())?;
    let mut req = client.get(url).header("Accept", "application/json");
    if let Some(key) = api_key {
        req = req.bearer_auth(key);
    }
    let resp = req.send().map_err(|e| format!("Civitai lookup failed: {}", e))?;
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !resp.status().is_success() {
        return Err(format!("Civitai API error: {}", resp.status()));
    }
    let raw: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    let trained_words = raw.get("trainedWords")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
        .unwrap_or_default();
    Ok(Some(CivitaiLookupResult {
        model_version_id: raw.get("id").and_then(|v| v.as_i64()),
        model_id: raw.get("modelId").and_then(|v| v.as_i64()),
        version_name: raw.get("name").and_then(|v| v.as_str()).map(|s| s.to_string()),
        model_name: raw.pointer("/model/name").and_then(|v| v.as_str()).map(|s| s.to_string()),
        model_type: raw.pointer("/model/type").and_then(|v| v.as_str()).map(|s| s.to_string()),
        nsfw: raw.pointer("/model/nsfw").cloned(),
        trained_words,
        raw,
    }))
}

// --- 存储配置相关命令 ---

/// 存储配置信息，包含用户自定义路径和最终解析路径
#[derive(Serialize, Deserialize)]
pub struct StorageConfig {
    pub storage_dir: Option<String>,
    pub resolved_dir: String,
    pub import_strategy: String,
    pub civitai_base_url: String,
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
        civitai_base_url: crate::config::normalize_civitai_base_url(&cfg.civitai_base_url),
    })
}

/// 设置存储目录，保存配置并确保子目录存在
#[tauri::command]
pub fn set_storage_dir(
    dir: Option<String>,
    import_strategy: Option<String>,
    civitai_base_url: Option<String>,
) -> Result<StorageConfig, String> {
    let mut cfg = crate::config::load_config();
    cfg.storage_dir = dir;
    if let Some(strategy) = import_strategy {
        if strategy == "copy" || strategy == "hardlink_then_copy" {
            cfg.import_strategy = strategy;
        }
    }
    if let Some(base_url) = civitai_base_url {
        cfg.civitai_base_url = crate::config::normalize_civitai_base_url(&base_url);
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
        civitai_base_url: crate::config::normalize_civitai_base_url(&cfg.civitai_base_url),
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
