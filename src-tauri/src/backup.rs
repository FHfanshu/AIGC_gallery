//! 图库备份导入导出命令
//!
//! 负责将图库数据库、原图和缩略图打包为 ZIP，以及从 ZIP 恢复数据。
//! 导出时对已压缩图片使用 Stored 模式，避免重复压缩拖慢速度。

use crate::AppState;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use walkdir::WalkDir;

/// 备份导入/导出进度事件载荷。
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BackupProgress {
    pub done: usize,
    pub total: usize,
    pub bytes_done: u64,
    pub total_bytes: u64,
    pub current: String,
    pub finished: bool,
}

/// 备份导入/导出完成事件载荷。
#[derive(Debug, Serialize, Deserialize)]
pub struct BackupResult {
    pub success: bool,
    pub message: String,
}

fn backup_progress_event(done: usize, total: usize, bytes_done: u64, total_bytes: u64, current: String, finished: bool) -> BackupProgress {
    BackupProgress { done, total, bytes_done, total_bytes, current, finished }
}

fn emit_backup_progress(app: &AppHandle, event: &str, progress: BackupProgress) {
    let _ = app.emit(event, progress);
}

fn should_store_without_compression(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()),
        Some(ext) if matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "webp" | "gif" | "zip")
    )
}

fn zip_options_for(path: &Path) -> zip::write::FileOptions {
    let method = if should_store_without_compression(path) {
        zip::CompressionMethod::Stored
    } else {
        zip::CompressionMethod::Deflated
    };
    zip::write::FileOptions::default().compression_method(method)
}

fn collect_backup_entries(root: &Path) -> Vec<(PathBuf, String, u64)> {
    let mut entries = Vec::new();
    let cfg_path = crate::config::default_storage_dir().join("config.json");
    if let Ok(meta) = cfg_path.metadata() {
        if meta.is_file() {
            entries.push((cfg_path, "config.json".to_string(), meta.len()));
        }
    }

    let db_path = root.join("gallery.db");
    if let Ok(meta) = db_path.metadata() {
        if meta.is_file() {
            entries.push((db_path, "gallery.db".to_string(), meta.len()));
        }
    }

    for (dir_name, dir) in [("images", root.join("images")), ("thumbnails", root.join("thumbnails"))] {
        if !dir.is_dir() { continue; }
        for entry in WalkDir::new(&dir).min_depth(1).into_iter().filter_map(|e| e.ok()) {
            if !entry.file_type().is_file() { continue; }
            let path = entry.into_path();
            let Ok(meta) = path.metadata() else { continue; };
            let Ok(rel_path) = path.strip_prefix(&dir) else { continue; };
            let rel = format!("{}/{}", dir_name, rel_path.to_string_lossy().replace('\\', "/"));
            entries.push((path, rel, meta.len()));
        }
    }
    entries
}

fn export_gallery_impl(app: Option<&AppHandle>, dest_path: String) -> Result<String, String> {
    let root = crate::config::resolve_storage_dir(&crate::config::load_config());
    let dest = PathBuf::from(&dest_path);
    let entries = collect_backup_entries(&root);
    let total = entries.len();
    let total_bytes = entries.iter().map(|(_, _, size)| *size).sum::<u64>();
    let mut bytes_done = 0u64;
    let mut last_emit = Instant::now();

    if let Some(app) = app {
        emit_backup_progress(app, "export-progress", backup_progress_event(0, total, 0, total_bytes, String::new(), false));
    }

    let file = fs::File::create(&dest).map_err(|e| format!("创建导出文件失败: {}", e))?;
    let mut zip = zip::ZipWriter::new(file);

    for (idx, (path, name, size)) in entries.iter().enumerate() {
        zip.start_file(name, zip_options_for(path)).map_err(|e| e.to_string())?;
        let mut input = fs::File::open(path).map_err(|e| format!("读取 {} 失败: {}", path.display(), e))?;
        std::io::copy(&mut input, &mut zip).map_err(|e| e.to_string())?;
        bytes_done = bytes_done.saturating_add(*size);

        if let Some(app) = app {
            if idx + 1 == total || (idx + 1) % 10 == 0 || last_emit.elapsed() >= Duration::from_millis(200) {
                last_emit = Instant::now();
                emit_backup_progress(app, "export-progress", backup_progress_event(
                    idx + 1,
                    total,
                    bytes_done,
                    total_bytes,
                    name.clone(),
                    false,
                ));
            }
        }
    }

    zip.finish().map_err(|e| e.to_string())?;
    if let Some(app) = app {
        emit_backup_progress(app, "export-progress", backup_progress_event(total, total, bytes_done, total_bytes, String::new(), true));
    }
    Ok(format!("导出成功：{} 个文件 → {}", total, dest_path))
}

fn import_gallery_impl(app: &AppHandle, zip_path: String) -> Result<String, String> {
    let root = crate::config::resolve_storage_dir(&crate::config::load_config());
    let src = PathBuf::from(&zip_path);

    if !src.exists() {
        return Err("zip 文件不存在".to_string());
    }

    let file = fs::File::open(&src).map_err(|e| format!("打开 zip 文件失败: {}", e))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("解析 zip 失败: {}", e))?;
    let total = archive.len();
    let total_bytes = (0..total).filter_map(|i| archive.by_index(i).ok().map(|entry| entry.size())).sum::<u64>();
    let mut restored = 0u32;
    let mut skipped = 0u32;
    let mut bytes_done = 0u64;
    let mut last_emit = Instant::now();

    emit_backup_progress(app, "backup-import-progress", backup_progress_event(0, total, 0, total_bytes, String::new(), false));

    for i in 0..total {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let entry_size = entry.size();
        let entry_name = entry.mangled_name();
        let current = entry_name.to_string_lossy().replace('\\', "/");

        if entry_name.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
            skipped += 1;
        } else if entry.is_dir() {
            skipped += 1;
        } else if current == "gallery.db" {
            let dest = root.join("gallery.db");
            if dest.exists() {
                let backup = root.join("gallery.db.bak");
                fs::copy(&dest, &backup).map_err(|e| format!("备份 DB 失败: {}", e))?;
            }
            let mut out = fs::File::create(&dest).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
            restored += 1;
        } else if current == "config.json" {
            skipped += 1;
        } else if !(current.starts_with("images/") || current.starts_with("thumbnails/")) {
            skipped += 1;
        } else {
            let dest = root.join(&current);
            if dest.exists() {
                skipped += 1;
            } else {
                if let Some(parent) = dest.parent() {
                    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                }
                let mut out = fs::File::create(&dest).map_err(|e| e.to_string())?;
                std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
                restored += 1;
            }
        }

        bytes_done = bytes_done.saturating_add(entry_size);
        if i + 1 == total || (i + 1) % 10 == 0 || last_emit.elapsed() >= Duration::from_millis(200) {
            last_emit = Instant::now();
            emit_backup_progress(app, "backup-import-progress", backup_progress_event(
                i + 1,
                total,
                bytes_done,
                total_bytes,
                current,
                false,
            ));
        }
    }

    match crate::db::Database::new() {
        Ok(new_db) => {
            let state = app.state::<AppState>();
            let mut db_lock = state.db.lock().map_err(|e| e.to_string())?;
            *db_lock = new_db;
        }
        Err(e) => return Err(format!("导入文件已恢复，但重新加载数据库失败: {}", e)),
    }

    emit_backup_progress(app, "backup-import-progress", backup_progress_event(total, total, bytes_done, total_bytes, String::new(), true));
    Ok(format!("导入成功：恢复 {} 个文件，跳过 {} 个", restored, skipped))
}

/// 导出图库数据到 .zip 文件。
#[tauri::command]
pub fn export_gallery(dest_path: String) -> Result<String, String> {
    export_gallery_impl(None, dest_path)
}

/// 后台导出图库数据，通过 export-progress / export-finished 事件推送进度。
#[tauri::command]
pub fn start_export_gallery(app: AppHandle, dest_path: String) -> Result<(), String> {
    std::thread::spawn(move || {
        let result = match export_gallery_impl(Some(&app), dest_path) {
            Ok(message) => BackupResult { success: true, message },
            Err(e) => BackupResult { success: false, message: e },
        };
        let _ = app.emit("export-finished", &result);
    });
    Ok(())
}

/// 导入图库数据从 .zip 文件。
#[tauri::command]
pub fn import_gallery(app: AppHandle, zip_path: String) -> Result<String, String> {
    import_gallery_impl(&app, zip_path)
}

/// 后台导入图库备份，通过 backup-import-progress / backup-import-finished 事件推送进度。
#[tauri::command]
pub fn start_import_gallery(app: AppHandle, zip_path: String) -> Result<(), String> {
    std::thread::spawn(move || {
        let result = match import_gallery_impl(&app, zip_path) {
            Ok(message) => BackupResult { success: true, message },
            Err(e) => BackupResult { success: false, message: e },
        };
        let _ = app.emit("backup-import-finished", &result);
    });
    Ok(())
}
