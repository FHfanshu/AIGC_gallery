// 缩略图生成工具：将源图片按比例缩放并保存为 JPEG
use std::path::{Path, PathBuf};

use image::ImageFormat;

/// 生成缩略图：读取源图，等比缩放至 max_size 以内，保存为 JPEG
pub fn generate_thumbnail(source_path: &Path, dest_dir: &Path, max_size: u32) -> Result<PathBuf, String> {
    // 确保目标目录存在
    std::fs::create_dir_all(dest_dir).map_err(|e| format!("Failed to create thumbnail dir: {}", e))?;

    // 打开源图
    let img = image::open(source_path)
        .map_err(|e| format!("Failed to open image for thumbnail: {}", e))?;

    // 等比缩放，使用 Lanczos3 插值
    let resized = img.resize(max_size, max_size, image::imageops::FilterType::Lanczos3);

    // Build destination path: {stem}_thumb.jpg
    let stem = source_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("image");
    let dest_path = dest_dir.join(format!("{}_thumb.jpg", stem));

    // 以 JPEG 格式写入文件
    let mut buf = std::io::BufWriter::new(
        std::fs::File::create(&dest_path)
            .map_err(|e| format!("Failed to create thumbnail file: {}", e))?,
    );
    resized
        .write_to(&mut buf, ImageFormat::Jpeg)
        .map_err(|e| format!("Failed to save thumbnail: {}", e))?;

    Ok(dest_path)
}
