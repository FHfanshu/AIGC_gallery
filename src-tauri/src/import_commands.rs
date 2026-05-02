//! 图片导入命令与后台任务
//!
//! 负责文件/文件夹导入、进度事件推送、存储复制和缩略图后台生成。

use crate::db::{NewImageRecord};
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

/// 导入进度阶段，用于前端区分拖入后等待、扫描、处理、完成等状态。
#[derive(Debug, Clone, Serialize)]
pub struct ImportProgress {
    pub phase: String,
    pub done: usize,
    pub total: usize,
    pub current: Option<String>,
    pub finished: bool,
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

fn emit_import_progress(app: &AppHandle, phase: &str, done: usize, total: usize, current: Option<&str>, finished: bool) {
    let _ = app.emit("import-progress", ImportProgress {
        phase: phase.to_string(),
        done,
        total,
        current: current.map(|s| s.to_string()),
        finished,
    });
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
fn is_supported_image_ext(ext: &str) -> bool {
    matches!(ext, "png" | "jpg" | "jpeg" | "webp")
}

fn prepare_single_image(
    db: &Arc<Mutex<crate::db::Database>>,
    path: &Path,
    result: &mut ImportResult,
    path_str: &str,
    ctx: &ImportContext,
) -> Option<(NewImageRecord, PathBuf, PathBuf)> {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    if !is_supported_image_ext(&ext) {
        result.skipped.push(format!("{}: Unsupported image format", path_str));
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

    let meta = match metadata::parse_image_metadata(path) {
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

pub fn collect_image_files(folder_path: &str) -> Vec<String> {
    WalkDir::new(folder_path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| {
            let path = e.path();
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
            is_supported_image_ext(&ext).then(|| path.to_string_lossy().to_string())
        })
        .collect()
}

pub fn import_files_batch(
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

    emit_import_progress(app, "processing", 0, total, None, false);

    for (idx, path_str) in file_paths.iter().enumerate() {
        let path = Path::new(path_str);
        if let Some((insert, stored_path, thumb_path)) = prepare_single_image(db, path, &mut result, path_str, &ctx) {
            pending.push(insert);
            thumbnails.push((stored_path, thumb_path));
        }
        if should_emit_progress(idx, total, &mut last_emit) {
            emit_import_progress(app, "processing", idx + 1, total, Some(path_str), false);
        }
    }

    emit_import_progress(app, "saving", total, total, None, false);
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

/// 同步扫描文件夹，递归导入其中所有支持的图片
#[tauri::command]
pub fn import_folder(
    app: AppHandle,
    state: State<AppState>,
    folder_path: String,
) -> Result<ImportResult, String> {
    emit_import_progress(&app, "scanning", 0, 0, Some(&folder_path), false);
    let files = collect_image_files(&folder_path);
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
    emit_import_progress(&app, "queued", 0, file_paths.len(), None, false);
    std::thread::spawn(move || {
        let total = file_paths.len();
        let result = match import_files_batch(&app, &db, file_paths, import_strategy) {
            Ok(result) => result,
            Err(e) => ImportResult { success: Vec::new(), skipped: Vec::new(), errors: vec![e] },
        };
        emit_import_progress(&app, "finished", total, total, None, true);
        let _ = app.emit("import-finished", &result);
        log::info!("background import_images done: {} success, {} skipped, {} errors",
            result.success.len(), result.skipped.len(), result.errors.len());
        if !result.errors.is_empty() {
            log::error!("background import_images errors: {}", result.errors.join(" | "));
        }
    });
    Ok(())
}

/// 后台线程扫描文件夹并导入支持的图片，通过事件推送进度
#[tauri::command]
pub fn start_import_folder(
    app: AppHandle,
    state: State<AppState>,
    folder_path: String,
    import_strategy: Option<String>,
) -> Result<(), String> {
    let db = state.db.clone();
    emit_import_progress(&app, "scanning", 0, 0, Some(&folder_path), false);
    std::thread::spawn(move || {
        let files = collect_image_files(&folder_path);
        let total = files.len();
        let result = match import_files_batch(&app, &db, files, import_strategy) {
            Ok(result) => result,
            Err(e) => ImportResult { success: Vec::new(), skipped: Vec::new(), errors: vec![e] },
        };
        emit_import_progress(&app, "finished", total, total, None, true);
        let _ = app.emit("import-finished", &result);
        log::info!("background import_folder done: {} success, {} skipped, {} errors",
            result.success.len(), result.skipped.len(), result.errors.len());
        if !result.errors.is_empty() {
            log::error!("background import_folder errors: {}", result.errors.join(" | "));
        }
    });
    Ok(())
}
