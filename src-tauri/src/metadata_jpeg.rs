//! JPEG 元数据解析模块
//!
//! 从 JPEG EXIF、APP1 XMP 和 COM 段中提取 AI 绘图元数据。

use std::collections::HashMap;
use std::fs::File;
use std::io::BufReader;
use std::path::Path;

use super::{insert_detected_text, looks_like_generation_params, parse_text_metadata, ImageMetadata};

/// 解析 JPEG 文件中的 EXIF / XMP / COM 文本元数据。
pub fn parse_jpeg_metadata(path: &Path) -> Result<ImageMetadata, String> {
    let mut text_chunks = HashMap::new();
    collect_exif_text(path, &mut text_chunks);
    collect_jpeg_segments(path, &mut text_chunks)?;
    parse_text_metadata(text_chunks, "JPEG")
}

/// 使用 EXIF 库读取常见文本字段，覆盖 UserComment / ImageDescription 等写入位置。
fn collect_exif_text(path: &Path, text_chunks: &mut HashMap<String, String>) {
    let Ok(file) = File::open(path) else { return; };
    let mut reader = BufReader::new(file);
    let Ok(exif) = exif::Reader::new().read_from_container(&mut reader) else { return; };

    for field in exif.fields() {
        let key = format!("{:?}", field.tag);
        let value = field.display_value().with_unit(&exif).to_string();
        insert_detected_text(text_chunks, &key, value);
        if key == "UserComment" {
            collect_user_comment_value(&field.value, text_chunks);
        }
    }
}

/// 扫描 JPEG marker，补充读取 EXIF 库不暴露的 COM 和 XMP 文本。
fn collect_jpeg_segments(path: &Path, text_chunks: &mut HashMap<String, String>) -> Result<(), String> {
    let data = std::fs::read(path).map_err(|e| e.to_string())?;
    if data.len() < 4 || data[0] != 0xFF || data[1] != 0xD8 {
        return Err("Not a valid JPEG file".to_string());
    }

    let mut pos = 2;
    while pos + 4 <= data.len() {
        while pos < data.len() && data[pos] == 0xFF {
            pos += 1;
        }
        if pos >= data.len() {
            break;
        }
        let marker = data[pos];
        pos += 1;

        // SOS 后就是压缩图像数据，常规元数据段已经结束。
        if marker == 0xDA || marker == 0xD9 {
            break;
        }
        if marker == 0x01 || (0xD0..=0xD7).contains(&marker) {
            continue;
        }
        if pos + 2 > data.len() {
            break;
        }
        let len = u16::from_be_bytes([data[pos], data[pos + 1]]) as usize;
        pos += 2;
        if len < 2 || pos + len - 2 > data.len() {
            break;
        }
        let segment = &data[pos..pos + len - 2];
        match marker {
            0xFE => insert_detected_text(text_chunks, "Comment", decode_text(segment)),
            0xE1 => collect_app1_segment(segment, text_chunks),
            _ => {}
        }
        pos += len - 2;
    }

    Ok(())
}

/// APP1 中可能承载 XMP 或 EXIF；EXIF 库有时只给出 UserComment 占位文本，需从原始段兜底解码。
fn collect_app1_segment(segment: &[u8], text_chunks: &mut HashMap<String, String>) {
    const XMP_HEADER: &[u8] = b"http://ns.adobe.com/xap/1.0/\0";
    const EXIF_HEADER: &[u8] = b"Exif\0\0";
    if let Some(xmp) = segment.strip_prefix(XMP_HEADER) {
        insert_detected_text(text_chunks, "xmp", decode_text(xmp));
    } else if let Some(exif) = segment.strip_prefix(EXIF_HEADER) {
        collect_exif_app1_text(exif, text_chunks);
    }
}

fn collect_user_comment_value(value: &exif::Value, text_chunks: &mut HashMap<String, String>) {
    match value {
        exif::Value::Undefined(bytes, _) | exif::Value::Byte(bytes) => {
            if let Some(text) = decode_exif_user_comment(bytes) {
                text_chunks.insert("parameters".to_string(), text.clone());
                text_chunks.insert("UserCommentRaw".to_string(), text);
            }
        }
        exif::Value::Ascii(values) => {
            for bytes in values {
                if let Some(text) = decode_exif_user_comment(bytes) {
                    text_chunks.insert("parameters".to_string(), text.clone());
                    text_chunks.insert("UserCommentRaw".to_string(), text);
                }
            }
        }
        _ => {}
    }
}

fn decode_exif_user_comment(bytes: &[u8]) -> Option<String> {
    let data = if bytes.len() >= 8 {
        let prefix = &bytes[..8];
        if prefix == b"ASCII\0\0\0" || prefix == b"JIS\0\0\0\0\0" || prefix == b"UNICODE\0" {
            &bytes[8..]
        } else {
            bytes
        }
    } else {
        bytes
    };

    let text = if bytes.len() >= 8 && &bytes[..8] == b"UNICODE\0" {
        decode_utf16_user_comment(data)
    } else {
        String::from_utf8_lossy(data).to_string()
    };
    let text = text.trim_matches(char::from(0)).trim().to_string();
    (!text.is_empty() && looks_like_generation_params(&text)).then_some(text)
}

fn decode_utf16_user_comment(data: &[u8]) -> String {
    let units: Vec<u16> = data
        .chunks_exact(2)
        .map(|chunk| u16::from_be_bytes([chunk[0], chunk[1]]))
        .collect();
    let be = String::from_utf16_lossy(&units);
    if looks_like_generation_params(&be) {
        return be;
    }

    let units: Vec<u16> = data
        .chunks_exact(2)
        .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
        .collect();
    String::from_utf16_lossy(&units)
}

fn collect_exif_app1_text(data: &[u8], text_chunks: &mut HashMap<String, String>) {
    collect_exif_ascii_patterns(data, text_chunks);
    collect_exif_utf16_patterns(data, text_chunks, false);
    collect_exif_utf16_patterns(data, text_chunks, true);
}

fn collect_exif_ascii_patterns(data: &[u8], text_chunks: &mut HashMap<String, String>) {
    let text = String::from_utf8_lossy(data);
    if let Some(start) = find_generation_start(&text) {
        let candidate = clean_candidate_text(&text[start..]);
        if looks_like_generation_params(&candidate) {
            text_chunks.entry("parameters".to_string()).or_insert(candidate);
        }
    }
}

fn collect_exif_utf16_patterns(data: &[u8], text_chunks: &mut HashMap<String, String>, little_endian: bool) {
    let units: Vec<u16> = data
        .chunks_exact(2)
        .map(|chunk| if little_endian {
            u16::from_le_bytes([chunk[0], chunk[1]])
        } else {
            u16::from_be_bytes([chunk[0], chunk[1]])
        })
        .collect();
    let text = String::from_utf16_lossy(&units);
    if let Some(start) = find_generation_start(&text) {
        let candidate = clean_candidate_text(&text[start..]);
        if looks_like_generation_params(&candidate) {
            text_chunks.entry("parameters".to_string()).or_insert(candidate);
        }
    }
}

fn find_generation_start(text: &str) -> Option<usize> {
    if let Some(pos) = text.find("Negative prompt:") {
        return Some(find_prompt_start(&text[..pos]));
    }
    text.find("Steps:").map(|pos| find_prompt_start(&text[..pos]))
}

fn find_prompt_start(before_params: &str) -> usize {
    // 不能取 Negative prompt 前最后一个换行；那通常是正向 prompt 的结尾，会把正向词整段裁掉。
    // APP1 原始兜底扫描只需要跳过 TIFF/UserComment 编码头，优先从编码头之后开始。
    for marker in ["啎䥃佄䔀", "UNICODE", "ASCII", "JIS"] {
        if let Some(pos) = before_params.rfind(marker) {
            return pos + marker.len();
        }
    }
    0
}

fn clean_candidate_text(text: &str) -> String {
    text
        .trim_matches(|ch: char| ch == '\0' || ch.is_control())
        .trim()
        // APP1 原始兜底扫描会从 TIFF 字节流中解码，可能把 UserComment 编码头误解为 UTF-16 字符。
        .trim_start_matches("啎䥃佄䔀")
        .trim_start_matches("UNICODE")
        .trim_start_matches("ASCII")
        .trim_matches(|ch: char| ch == '\0' || ch.is_control())
        .trim()
        .to_string()
}

fn decode_text(data: &[u8]) -> String {
    String::from_utf8_lossy(data).to_string()
}
