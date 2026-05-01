//! 应用数据路径工具
//!
//! DB、配置、图片和缩略图默认都放在项目/可执行程序旁的 gallery-data 中。

use std::path::PathBuf;

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
