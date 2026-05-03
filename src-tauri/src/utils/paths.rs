//! 应用数据路径工具
//!
//! DB、配置、图片和缩略图默认都放在项目/可执行程序旁的 gallery-data 中。
//! 运行时会把旧安装目录里的内部图片路径重定位到当前 gallery-data，避免换安装器后路径失效。

use std::path::{Component, Path, PathBuf};

use crate::config;

/// 图库根目录
pub fn app_data_dir() -> PathBuf {
    let cfg = config::load_config();
    config::resolve_storage_dir(&cfg)
}

/// 数据库路径
pub fn db_path() -> PathBuf {
    app_data_dir().join("gallery.db")
}

fn path_tail_after_dir(path: &Path, dir_name: &str) -> Option<PathBuf> {
    let mut seen_dir = false;
    let mut tail = PathBuf::new();

    for component in path.components() {
        let Component::Normal(part) = component else {
            continue;
        };
        if seen_dir {
            tail.push(part);
            continue;
        }
        if part.to_string_lossy().eq_ignore_ascii_case(dir_name) {
            seen_dir = true;
        }
    }

    if seen_dir && tail.components().next().is_some() {
        Some(tail)
    } else {
        None
    }
}

/// 将数据库中保存的内部存储路径重定位到当前图库根目录。
///
/// 旧版本把 `stored_path` / `thumbnail_path` 写成绝对路径；NSIS/MSI 安装目录变化后，
/// DB 仍会指向旧目录。这里保留仍然存在的路径，只在目标不存在时按 `images/` 或
/// `thumbnails/` 后面的相对部分映射到当前 `gallery-data`。
pub fn relocate_gallery_file_path(path: &str, dir_name: &str) -> PathBuf {
    let raw = PathBuf::from(path);
    if raw.exists() {
        return raw;
    }

    let root = app_data_dir();
    if let Some(tail) = path_tail_after_dir(&raw, dir_name) {
        return root.join(dir_name).join(tail);
    }

    if let Some(file_name) = raw.file_name() {
        return root.join(dir_name).join(file_name);
    }

    raw
}

/// 序列化给前端前使用的内部路径重定位。
pub fn relocate_gallery_file_path_string(path: Option<String>, dir_name: &str) -> Option<String> {
    path.filter(|p| !p.trim().is_empty())
        .map(|p| relocate_gallery_file_path(&p, dir_name).to_string_lossy().to_string())
}
