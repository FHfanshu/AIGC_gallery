// 缩略图生成工具：将源图片按比例缩放并保存为 JPEG
use std::path::{Path, PathBuf};

use image::ImageFormat;

/// 生成缩略图到指定路径：导入流程可先写入 DB，之后后台补齐这个文件。
pub fn generate_thumbnail_to_path(source_path: &Path, dest_path: &Path, max_size: u32) -> Result<PathBuf, String> {
    if let Some(parent) = dest_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create thumbnail dir: {}", e))?;
    }
    let img = image::open(source_path)
        .map_err(|e| format!("Failed to open image for thumbnail: {}", e))?;
    let resized = img.resize(max_size, max_size, image::imageops::FilterType::Triangle);
    let mut buf = std::io::BufWriter::new(
        std::fs::File::create(dest_path)
            .map_err(|e| format!("Failed to create thumbnail file: {}", e))?,
    );
    resized
        .write_to(&mut buf, ImageFormat::Jpeg)
        .map_err(|e| format!("Failed to save thumbnail: {}", e))?;
    Ok(dest_path.to_path_buf())
}
