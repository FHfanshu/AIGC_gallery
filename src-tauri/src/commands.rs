//! Tauri IPC 命令集合
//!
//! 包含图片查询、删除、标签管理、收藏、Prompt 编辑、外部服务与配置等功能。
use crate::db::{AiAnnotation, AiTagTarget, ImageRecord, ImageStats, TagRecord};
use crate::metadata;
use crate::AppState;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::process::Command;
use std::sync::Arc;
use std::time::Duration;
use base64::Engine;
use tauri::{AppHandle, Emitter, State};

/// 分页查询图片列表，支持关键词搜索
#[tauri::command]
pub fn get_images(
    state: State<AppState>,
    offset: Option<i64>,
    limit: Option<i64>,
    search: Option<String>,
    sort_by: Option<String>,
    sort_dir: Option<String>,
) -> Result<Vec<ImageRecord>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let imgs = db.get_images(
        offset.unwrap_or(0),
        limit.unwrap_or(50),
        search.as_deref(),
        sort_by.as_deref().unwrap_or("created_at"),
        sort_dir.as_deref().unwrap_or("desc"),
    )?;
    log::debug!("get_images: offset={:?} limit={:?} search={:?} sort_by={:?} sort_dir={:?} -> {} results",
        offset, limit, search, sort_by, sort_dir, imgs.len());
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

/// 在系统文件管理器中定位图片文件。
#[tauri::command]
pub fn reveal_image_in_file_manager(
    state: State<AppState>,
    image_id: i64,
) -> Result<(), String> {
    let image = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.get_image_by_id(image_id)?
    };

    let file_path = image
        .stored_path
        .as_deref()
        .filter(|path| !path.is_empty() && Path::new(path).exists())
        .unwrap_or(&image.file_path);
    let path = Path::new(file_path);
    if !path.exists() {
        return Err(format!("Image file not found: {}", file_path));
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(format!("/select,{}", path.display()))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-R")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let target = path.parent().unwrap_or(path);
        Command::new("xdg-open")
            .arg(target)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// 按当前图片文件重新解析元数据，并写回数据库。
#[tauri::command]
pub fn reparse_image_metadata(
    state: State<AppState>,
    image_id: i64,
) -> Result<ImageRecord, String> {
    let image = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.get_image_by_id(image_id)?
    };

    let source_path = image
        .stored_path
        .as_deref()
        .filter(|path| !path.is_empty())
        .unwrap_or(&image.file_path);
    let path = Path::new(source_path);
    if !path.exists() {
        return Err(format!("Image file not found: {}", source_path));
    }

    let meta = metadata::parse_image_metadata(path)?;
    let (width, height) = if meta.width.unwrap_or(0) > 0 && meta.height.unwrap_or(0) > 0 {
        (meta.width.unwrap_or(0), meta.height.unwrap_or(0))
    } else {
        metadata::get_image_dimensions(path).unwrap_or((image.width, image.height))
    };
    let metadata_json = serde_json::to_string(&meta).map_err(|e| e.to_string())?;

    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.update_image_metadata(
        image_id,
        width,
        height,
        &meta.prompt,
        &meta.negative_prompt,
        &metadata_json,
        &meta.source,
    )?;
    db.get_image_by_id(image_id)
}

/// 批量重新解析图库中的图片元数据，并通过进度事件反馈。
#[tauri::command]
pub fn start_reparse_all_metadata(state: State<AppState>, app: AppHandle) -> Result<(), String> {
    let db_state = Arc::clone(&state.db);
    std::thread::spawn(move || {
        let ids = {
            let db = db_state.lock().map_err(|e| e.to_string());
            match db {
                Ok(db) => match db.get_all_image_ids() {
                    Ok(ids) => ids,
                    Err(e) => {
                        log::error!("start_reparse_all_metadata failed to load ids: {}", e);
                        return;
                    }
                },
                Err(e) => {
                    log::error!("start_reparse_all_metadata lock error: {}", e);
                    return;
                }
            }
        };

        let total = ids.len();
        for (index, image_id) in ids.into_iter().enumerate() {
            let _ = app.emit("reparse-progress", serde_json::json!({
                "done": index,
                "total": total,
                "current": image_id,
            }));

            let image = {
                let db = match db_state.lock() {
                    Ok(db) => db,
                    Err(e) => {
                        log::error!("start_reparse_all_metadata lock error: {}", e);
                        continue;
                    }
                };
                match db.get_image_by_id(image_id) {
                    Ok(img) => img,
                    Err(e) => {
                        log::error!("start_reparse_all_metadata load image {} failed: {}", image_id, e);
                        continue;
                    }
                }
            };

            let source_path = image
                .stored_path
                .as_deref()
                .filter(|path| !path.is_empty())
                .unwrap_or(&image.file_path)
                .to_string();
            let path = Path::new(&source_path);
            if !path.exists() {
                log::warn!("start_reparse_all_metadata missing file: {}", source_path);
                continue;
            }

            let meta = match metadata::parse_image_metadata(path) {
                Ok(meta) => meta,
                Err(e) => {
                    log::warn!("start_reparse_all_metadata parse failed for {}: {}", source_path, e);
                    continue;
                }
            };
            let (width, height) = if meta.width.unwrap_or(0) > 0 && meta.height.unwrap_or(0) > 0 {
                (meta.width.unwrap_or(0), meta.height.unwrap_or(0))
            } else {
                metadata::get_image_dimensions(path).unwrap_or((image.width, image.height))
            };
            let metadata_json = match serde_json::to_string(&meta) {
                Ok(v) => v,
                Err(e) => {
                    log::warn!("start_reparse_all_metadata serialize failed for {}: {}", source_path, e);
                    continue;
                }
            };

            let db = match db_state.lock() {
                Ok(db) => db,
                Err(e) => {
                    log::error!("start_reparse_all_metadata lock error: {}", e);
                    continue;
                }
            };
            if let Err(e) = db.update_image_metadata(
                image_id,
                width,
                height,
                &meta.prompt,
                &meta.negative_prompt,
                &metadata_json,
                &meta.source,
            ) {
                log::warn!("start_reparse_all_metadata update failed for {}: {}", image_id, e);
            }
        }

        let _ = app.emit("reparse-finished", serde_json::json!({
            "total": total,
        }));
    });

    Ok(())
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
    pub page_url: Option<String>,
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
        .timeout(Duration::from_secs(12))
        .connect_timeout(Duration::from_secs(5))
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
    let model_version_id = raw.get("id").and_then(|v| v.as_i64());
    let model_id = raw.get("modelId").and_then(|v| v.as_i64());
    let page_url = match (model_id, model_version_id) {
        (Some(model_id), Some(version_id)) => Some(format!("{}/models/{}?modelVersionId={}", base_url, model_id, version_id)),
        (Some(model_id), None) => Some(format!("{}/models/{}", base_url, model_id)),
        _ => None,
    };

    Ok(Some(CivitaiLookupResult {
        model_version_id,
        model_id,
        version_name: raw.get("name").and_then(|v| v.as_str()).map(|s| s.to_string()),
        model_name: raw.pointer("/model/name").and_then(|v| v.as_str()).map(|s| s.to_string()),
        model_type: raw.pointer("/model/type").and_then(|v| v.as_str()).map(|s| s.to_string()),
        page_url,
        nsfw: raw.pointer("/model/nsfw").cloned(),
        trained_words,
        raw,
    }))
}

/// 使用系统默认浏览器打开 Civitai 页面。
#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    let trimmed = url.trim();
    if !(trimmed.starts_with("https://civitai.com/")
        || trimmed.starts_with("https://civitai.green/")
        || trimmed.starts_with("https://civitai.red/"))
    {
        return Err("Unsupported URL".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", trimmed])
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(trimmed)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(trimmed)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

const AI_TAG_SERVICE: &str = "aigc-gallery";
const AI_TAG_KEY_USER: &str = "ai-tag-api-key";

#[derive(Debug, Serialize, Deserialize)]
pub struct AiTagKeyStatus { pub has_key: bool }

#[derive(Debug, Serialize, Deserialize)]
pub struct AiTagConfig { pub base_url: String, pub model: String }

fn image_path_for_ai(target: &AiTagTarget) -> Option<String> {
    for candidate in [target.thumbnail_path.as_deref(), target.stored_path.as_deref(), Some(target.file_path.as_str())].into_iter().flatten() {
        if !candidate.trim().is_empty() && Path::new(candidate).exists() { return Some(candidate.to_string()); }
    }
    None
}

fn call_ai_tag_api(api_key: &str, cfg: &AiTagConfig, image_path: &str) -> Result<AiAnnotation, String> {
    let bytes = fs::read(image_path).map_err(|e| e.to_string())?;
    let lower_path = image_path.to_lowercase();
    let mime = if lower_path.ends_with(".jpg") || lower_path.ends_with(".jpeg") {
        "image/jpeg"
    } else if lower_path.ends_with(".webp") {
        "image/webp"
    } else {
        "image/png"
    };
    let data_uri = format!("data:{};base64,{}", mime, base64::engine::general_purpose::STANDARD.encode(bytes));
    let url = format!("{}/chat/completions", crate::config::normalize_ai_tag_base_url(&cfg.base_url));
    log::info!("AI tag request: url={}, model={}", url, cfg.model);
    let body = serde_json::json!({
        "model": cfg.model,
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": "请根据图片内容返回严格 JSON，字段必须为 caption_zh, caption_en, tags_zh, tags_en。caption 是简短说明；tags 数组各 5-12 个，适合图库搜索。不要输出 Markdown。"},
            {"type": "image_url", "image_url": {"url": data_uri}}
        ]}],
        "response_format": {"type": "json_object"},
        "stream": false
    });
    let client = reqwest::blocking::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
        .timeout(Duration::from_secs(60)).connect_timeout(Duration::from_secs(10)).build().map_err(|e| e.to_string())?;
    let resp = client.post(&url).bearer_auth(api_key)
        .header("Accept", "application/json")
        .header("Accept-Language", "en-US,en;q=0.9")
        .header("Content-Type", "application/json")
        .header("Sec-Fetch-Dest", "empty")
        .header("Sec-Fetch-Mode", "cors")
        .header("Sec-Fetch-Site", "cross-site")
        .json(&body).send().map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        let status = resp.status();
        let resp_body = resp.text().unwrap_or_default();
        log::error!("AI tag API {} -> {}: {}", url, status, resp_body);
        return Err(format!("AI tag API error: {} — {}", status, &resp_body[..resp_body.len().min(300)]));
    }
    let raw: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    let content = raw.pointer("/choices/0/message/content").and_then(|v| v.as_str()).ok_or_else(|| "AI response missing content".to_string())?;
    let parsed: serde_json::Value = serde_json::from_str(content).map_err(|e| format!("AI JSON parse failed: {}", e))?;
    let to_vec = |name: &str| -> Vec<String> { parsed.get(name).and_then(|v| v.as_array()).map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.trim().to_string())).filter(|s| !s.is_empty()).collect()).unwrap_or_default() };
    Ok(AiAnnotation { caption_zh: parsed.get("caption_zh").and_then(|v| v.as_str()).unwrap_or("").to_string(), caption_en: parsed.get("caption_en").and_then(|v| v.as_str()).unwrap_or("").to_string(), tags_zh: to_vec("tags_zh"), tags_en: to_vec("tags_en"), model: cfg.model.clone(), updated_at: String::new() })
}

#[tauri::command]
pub fn get_ai_tag_key_status() -> Result<AiTagKeyStatus, String> {
    let entry = keyring::Entry::new(AI_TAG_SERVICE, AI_TAG_KEY_USER).map_err(|e| e.to_string())?;
    Ok(AiTagKeyStatus { has_key: entry.get_password().map(|s| !s.trim().is_empty()).unwrap_or(false) })
}

#[tauri::command]
pub fn set_ai_tag_api_key(api_key: String) -> Result<AiTagKeyStatus, String> {
    let entry = keyring::Entry::new(AI_TAG_SERVICE, AI_TAG_KEY_USER).map_err(|e| e.to_string())?;
    let trimmed = api_key.trim();
    if trimmed.is_empty() { let _ = entry.delete_credential(); return Ok(AiTagKeyStatus { has_key: false }); }
    entry.set_password(trimmed).map_err(|e| e.to_string())?;
    Ok(AiTagKeyStatus { has_key: true })
}

#[tauri::command]
pub fn get_ai_tag_config() -> Result<AiTagConfig, String> {
    let cfg = crate::config::load_config();
    Ok(AiTagConfig { base_url: crate::config::normalize_ai_tag_base_url(&cfg.ai_tag_base_url), model: crate::config::normalize_ai_tag_model(&cfg.ai_tag_model) })
}

#[tauri::command]
pub fn set_ai_tag_config(base_url: String, model: String) -> Result<AiTagConfig, String> {
    let mut cfg = crate::config::load_config();
    cfg.ai_tag_base_url = crate::config::normalize_ai_tag_base_url(&base_url);
    cfg.ai_tag_model = crate::config::normalize_ai_tag_model(&model);
    crate::config::save_config(&cfg)?;
    Ok(AiTagConfig { base_url: cfg.ai_tag_base_url, model: cfg.ai_tag_model })
}

#[tauri::command]
pub fn start_ai_tagging_missing_images(app: AppHandle, state: State<AppState>) -> Result<(), String> {
    let entry = keyring::Entry::new(AI_TAG_SERVICE, AI_TAG_KEY_USER).map_err(|e| e.to_string())?;
    let api_key = entry.get_password().map_err(|_| "AI tag API key not set".to_string())?;
    let cfg0 = crate::config::load_config();
    let cfg = AiTagConfig { base_url: crate::config::normalize_ai_tag_base_url(&cfg0.ai_tag_base_url), model: crate::config::normalize_ai_tag_model(&cfg0.ai_tag_model) };
    let db_state = Arc::clone(&state.db);
    std::thread::spawn(move || {
        let targets = match db_state.lock().map_err(|e| e.to_string()).and_then(|db| db.get_images_needing_ai_annotation()) { Ok(v) => v, Err(e) => { log::error!("load ai tag targets failed: {}", e); return; } };
        let total = targets.len();
        if total == 0 {
            let _ = app.emit("ai-tagging-finished", serde_json::json!({"total": 0, "success": 0, "errors": 0, "empty": true}));
            return;
        }
        let mut success = 0usize; let mut errors = 0usize;
        for (idx, target) in targets.into_iter().enumerate() {
            let _ = app.emit("ai-tagging-progress", serde_json::json!({"done": idx, "total": total, "current": target.id, "finished": false}));
            let result = image_path_for_ai(&target).ok_or_else(|| "image file not found".to_string()).and_then(|path| call_ai_tag_api(&api_key, &cfg, &path));
            match result {
                Ok(annotation) => { if db_state.lock().map_err(|e| e.to_string()).and_then(|db| db.upsert_ai_annotation(target.id, &annotation)).is_ok() { success += 1; } else { errors += 1; } }
                Err(e) => { errors += 1; let _ = db_state.lock().map_err(|e| e.to_string()).and_then(|db| db.upsert_ai_annotation_error(target.id, &cfg.model, &e)); log::warn!("ai tag failed for {}: {}", target.id, e); }
            }
            let _ = app.emit("ai-tagging-progress", serde_json::json!({"done": idx + 1, "total": total, "current": target.id, "finished": idx + 1 == total}));
        }
        let _ = app.emit("ai-tagging-finished", serde_json::json!({"total": total, "success": success, "errors": errors}));
    });
    Ok(())
}

// --- 存储配置相关命令 ---

/// 存储配置信息，包含用户自定义路径和最终解析路径
#[derive(Serialize, Deserialize)]
pub struct StorageConfig {
    pub storage_dir: Option<String>,
    pub resolved_dir: String,
    pub import_strategy: String,
    pub civitai_base_url: String,
    pub ai_tag_base_url: String,
    pub ai_tag_model: String,
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
        ai_tag_base_url: crate::config::normalize_ai_tag_base_url(&cfg.ai_tag_base_url),
        ai_tag_model: crate::config::normalize_ai_tag_model(&cfg.ai_tag_model),
    })
}

/// 设置存储目录，保存配置并确保子目录存在
#[tauri::command]
pub fn set_storage_dir(
    dir: Option<String>,
    import_strategy: Option<String>,
    civitai_base_url: Option<String>,
    ai_tag_base_url: Option<String>,
    ai_tag_model: Option<String>,
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
    if let Some(base_url) = ai_tag_base_url {
        cfg.ai_tag_base_url = crate::config::normalize_ai_tag_base_url(&base_url);
    }
    if let Some(model) = ai_tag_model {
        cfg.ai_tag_model = crate::config::normalize_ai_tag_model(&model);
    }
    crate::config::save_config(&cfg)?;
    let resolved = crate::config::resolve_storage_dir(&cfg);
    // 确保 images 和 thumbnails 子目录存在
    std::fs::create_dir_all(resolved.join("images")).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(resolved.join("thumbnails")).map_err(|e| e.to_string())?;
    Ok(StorageConfig {
        storage_dir: cfg.storage_dir,
        resolved_dir: resolved.to_string_lossy().to_string(),
        import_strategy: cfg.import_strategy,
        civitai_base_url: crate::config::normalize_civitai_base_url(&cfg.civitai_base_url),
        ai_tag_base_url: crate::config::normalize_ai_tag_base_url(&cfg.ai_tag_base_url),
        ai_tag_model: crate::config::normalize_ai_tag_model(&cfg.ai_tag_model),
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
        let lower_path = file_path.to_lowercase();
        let mime = if lower_path.ends_with(".jpg") || lower_path.ends_with(".jpeg") {
            "image/jpeg"
        } else if lower_path.ends_with(".webp") {
            "image/webp"
        } else {
            "image/png"
        };
        return Ok(format!("data:{};base64,{}", mime, b64));
    }

    Err(format!("No existing image file found for image id {}", image_id))
}
