use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppConfig {
    /// Custom storage directory. If None, uses default (exe dir / gallery-data)
    pub storage_dir: Option<String>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self { storage_dir: None }
    }
}

fn config_path() -> PathBuf {
    let data_dir = dirs_next::data_dir()
        .unwrap_or_else(|| PathBuf::from("."));
    data_dir.join("aigc-gallery").join("config.json")
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

/// Resolve the actual storage directory from config.
/// Default: <exe_dir>/gallery-data (dev-friendly, portable)
pub fn resolve_storage_dir(config: &AppConfig) -> PathBuf {
    if let Some(ref custom) = config.storage_dir {
        let p = PathBuf::from(custom);
        if p.is_absolute() {
            return p;
        }
    }
    // Default: next to the executable
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."));
    exe_dir.join("gallery-data")
}
