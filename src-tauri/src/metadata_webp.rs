//! WebP 元数据解析模块
//!
//! 从 RIFF WebP 容器的 EXIF / XMP chunk 中提取 AI 绘图元数据。

use std::collections::HashMap;
use std::path::Path;

use super::{insert_detected_text, parse_text_metadata, ImageMetadata};

/// 解析 WebP 文件中的 EXIF / XMP 文本元数据。
pub fn parse_webp_metadata(path: &Path) -> Result<ImageMetadata, String> {
    let data = std::fs::read(path).map_err(|e| e.to_string())?;
    if data.len() < 12 || &data[0..4] != b"RIFF" || &data[8..12] != b"WEBP" {
        return Err("Not a valid WebP file".to_string());
    }

    let mut text_chunks = HashMap::new();
    let mut pos = 12;
    while pos + 8 <= data.len() {
        let chunk_type = &data[pos..pos + 4];
        let chunk_size = u32::from_le_bytes([data[pos + 4], data[pos + 5], data[pos + 6], data[pos + 7]]) as usize;
        pos += 8;
        if pos + chunk_size > data.len() {
            break;
        }
        let chunk = &data[pos..pos + chunk_size];
        match chunk_type {
            b"EXIF" => collect_exif_chunk(chunk, &mut text_chunks),
            b"XMP " => insert_detected_text(&mut text_chunks, "xmp", decode_text(chunk)),
            _ => {}
        }
        pos += chunk_size + (chunk_size % 2);
    }

    parse_text_metadata(text_chunks, "WebP")
}

/// WebP EXIF chunk 通常是 TIFF 数据，exif crate 可直接从原始 EXIF 数据读取。
fn collect_exif_chunk(chunk: &[u8], text_chunks: &mut HashMap<String, String>) {
    let Ok(exif) = exif::Reader::new().read_raw(chunk.to_vec()) else { return; };

    for field in exif.fields() {
        let key = format!("{:?}", field.tag);
        let value = field.display_value().with_unit(&exif).to_string();
        insert_detected_text(text_chunks, &key, value);
    }
}

fn decode_text(data: &[u8]) -> String {
    String::from_utf8_lossy(data).to_string()
}
