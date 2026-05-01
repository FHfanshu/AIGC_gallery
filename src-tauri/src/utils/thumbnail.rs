use std::path::{Path, PathBuf};
use image::ImageFormat;

pub fn generate_thumbnail(source_path: &Path, dest_dir: &Path, max_size: u32) -> Result<PathBuf, String> {
    // Create dest_dir if it doesn't exist
    std::fs::create_dir_all(dest_dir).map_err(|e| format!("Failed to create thumbnail dir: {}", e))?;

    // Open and resize image
    let img = image::open(source_path)
        .map_err(|e| format!("Failed to open image for thumbnail: {}", e))?;

    let resized = img.resize(max_size, max_size, image::imageops::FilterType::Lanczos3);

    // Build destination path: {stem}_thumb.jpg
    let stem = source_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("image");
    let dest_path = dest_dir.join(format!("{}_thumb.jpg", stem));

    // Save as JPEG with quality 80
    let mut buf = std::io::BufWriter::new(
        std::fs::File::create(&dest_path)
            .map_err(|e| format!("Failed to create thumbnail file: {}", e))?,
    );
    resized
        .write_to(&mut buf, ImageFormat::Jpeg)
        .map_err(|e| format!("Failed to save thumbnail: {}", e))?;

    Ok(dest_path)
}
