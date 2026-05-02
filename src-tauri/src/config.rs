//! 应用配置读写与图库目录解析
//!
//! 默认将 DB、配置、图片和缩略图都放在项目/可执行程序旁的 gallery-data，避免写入 C 盘 AppData。

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppConfig {
    /// 自定义图库根目录；为空时使用默认 gallery-data
    pub storage_dir: Option<String>,
    /// 导入策略：copy / hardlink_then_copy
    #[serde(default = "default_import_strategy")]
    pub import_strategy: String,
    /// Civitai API 基础域名预设
    #[serde(default = "default_civitai_base_url")]
    pub civitai_base_url: String,
    /// OpenAI 兼容视觉接口地址，用于无 Prompt 图片打标
    #[serde(default = "default_ai_tag_base_url")]
    pub ai_tag_base_url: String,
    /// 视觉打标模型 ID
    #[serde(default = "default_ai_tag_model")]
    pub ai_tag_model: String,
}

fn default_import_strategy() -> String {
    "copy".to_string()
}

pub fn default_civitai_base_url() -> String {
    "https://civitai.com".to_string()
}

pub fn default_ai_tag_base_url() -> String {
    "https://api.openai.com/v1".to_string()
}

pub fn default_ai_tag_model() -> String {
    "gpt-4o-mini".to_string()
}

pub fn normalize_ai_tag_base_url(base_url: &str) -> String {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return default_ai_tag_base_url();
    }
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{}", trimmed)
    }
}

pub fn normalize_ai_tag_model(model: &str) -> String {
    let trimmed = model.trim();
    if trimmed.is_empty() { default_ai_tag_model() } else { trimmed.to_string() }
}

pub fn normalize_civitai_base_url(base_url: &str) -> String {
    let trimmed = base_url.trim().trim_end_matches('/');
    match trimmed {
        "civitai.com" | "https://civitai.com" => "https://civitai.com".to_string(),
        "civitai.green" | "https://civitai.green" => "https://civitai.green".to_string(),
        "civitai.red" | "https://civitai.red" => "https://civitai.red".to_string(),
        _ => default_civitai_base_url(),
    }
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            storage_dir: None,
            import_strategy: default_import_strategy(),
            civitai_base_url: default_civitai_base_url(),
            ai_tag_base_url: default_ai_tag_base_url(),
            ai_tag_model: default_ai_tag_model(),
        }
    }
}

/// 默认图库根目录。
///
/// 开发模式下 current_exe 位于 src-tauri/target/debug，不能把数据放进 target，
/// 因为 cargo clean 会删除它。因此检测到该结构时使用项目根目录/gallery-data。
/// 发布模式下使用 exe 同级目录/gallery-data。
pub fn default_storage_dir() -> PathBuf {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));

    if exe_dir.file_name().and_then(|s| s.to_str()) == Some("debug") {
        if let Some(target_dir) = exe_dir.parent() {
            if target_dir.file_name().and_then(|s| s.to_str()) == Some("target") {
                if let Some(src_tauri_dir) = target_dir.parent() {
                    if src_tauri_dir.file_name().and_then(|s| s.to_str()) == Some("src-tauri") {
                        if let Some(project_root) = src_tauri_dir.parent() {
                            return project_root.join("gallery-data");
                        }
                    }
                }
            }
        }
    }

    exe_dir.join("gallery-data")
}

fn config_path() -> PathBuf {
    default_storage_dir().join("config.json")
}

pub fn load_config() -> AppConfig {
    let path = config_path();
    if path.exists() {
        match fs::read_to_string(&path) {
            Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
            Err(_) => AppConfig::default(),
        }
    } else {
        AppConfig::default()
    }
}

pub fn save_config(config: &AppConfig) -> Result<(), String> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

/// 解析实际图库根目录。
///
/// 自定义目录支持绝对路径；相对路径会以默认 gallery-data 为基准。
pub fn resolve_storage_dir(config: &AppConfig) -> PathBuf {
    if let Some(ref custom) = config.storage_dir {
        let p = PathBuf::from(custom);
        if p.is_absolute() {
            return p;
        }
        if !custom.trim().is_empty() {
            return default_storage_dir().join(Path::new(custom));
        }
    }

    default_storage_dir()
}
