//! PNG 元数据解析模块
//!
//! 从 PNG 文件的 tEXt / iTXt chunk 中提取 AI 绘图元数据。

use std::collections::HashMap;
use std::fs::File;
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::path::Path;

use super::{detect_c2pa_gpt_image, parse_text_metadata, ImageMetadata};

/// 解析 PNG 文件的 tEXt / iTXt chunk，自动检测来源并返回结构化元数据
///
/// # 流程
/// 1. 验证 PNG 签名（8 字节魔数）
/// 2. 遍历所有 chunk，收集 tEXt 和 iTXt 类型的 key-value
/// 3. 根据 key 特征判断来源，调用对应的解析器
pub fn parse_png_metadata(path: &Path) -> Result<ImageMetadata, String> {
    let file = File::open(path).map_err(|e| format!("Failed to open file: {}", e))?;
    let mut reader = BufReader::new(file);

    // 验证 PNG 文件签名：89 50 4E 47 0D 0A 1A 0A
    let mut sig = [0u8; 8];
    reader.read_exact(&mut sig).map_err(|e| e.to_string())?;
    if sig != [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] {
        return Err("Not a valid PNG file".to_string());
    }

    // 收集所有文本 chunk 的 key-value 对
    let mut text_chunks: HashMap<String, String> = HashMap::new();
    // 用于检测 C2PA/GPT-image 的原始数据缓冲区
    let mut c2pa_raw: Vec<u8> = Vec::new();

    // 逐 chunk 读取：length(4B) + type(4B) + data(length B) + crc(4B)
    loop {
        let mut length_buf = [0u8; 4];
        match reader.read_exact(&mut length_buf) {
            Ok(_) => {}
            Err(_) => break,
        }
        let length = u32::from_be_bytes(length_buf);

        let mut type_buf = [0u8; 4];
        if reader.read_exact(&mut type_buf).is_err() {
            break;
        }
        let chunk_type = String::from_utf8_lossy(&type_buf).to_string();

        // IDAT 是压缩像素数据，导入只需要元数据，必须 seek 跳过而不是读入整张图片。
        // 否则拖入大 PNG 时后台线程会额外完整读一遍文件，造成明显磁盘 IO 卡顿。
        if chunk_type == "IDAT" {
            reader.seek(SeekFrom::Current(length as i64)).map_err(|e| e.to_string())?;
            let mut crc = [0u8; 4];
            if reader.read_exact(&mut crc).is_err() {
                break;
            }
            continue;
        }

        let mut data = Vec::new();
        data.resize(length as usize, 0);
        if reader.read_exact(&mut data).is_err() {
            break;
        }

        // 跳过 CRC 校验（不做验证，仅消费字节）
        let mut crc = [0u8; 4];
        if reader.read_exact(&mut crc).is_err() {
            break;
        }

        // tEXt chunk：key\0value（Latin-1 编码，无压缩）
        if chunk_type == "tEXt" {
            if let Some(null_pos) = data.iter().position(|&b| b == 0) {
                let key = String::from_utf8_lossy(&data[..null_pos]).to_string();
                let value = String::from_utf8_lossy(&data[null_pos + 1..]).to_string();
                text_chunks.insert(key, value);
            }
        } else if chunk_type == "iTXt" {
            // iTXt 格式：keyword\0compression_flag\0compression_method\0language_tag\0translated_keyword\0text
            if let Some(null_pos) = data.iter().position(|&b| b == 0) {
                let key = String::from_utf8_lossy(&data[..null_pos]).to_string();
                let rest = &data[null_pos + 1..];
                // 跳过：compression_flag(1B) + compression_method(1B) = 2 字节
                if rest.len() > 2 {
                    let mut pos = 2;
                    // 跳过 language_tag 和 translated_keyword（各以 \0 分隔）
                    for _ in 0..2 {
                        if let Some(p) = rest[pos..].iter().position(|&b| b == 0) {
                            pos += p + 1;
                        }
                    }
                    let text_data = &rest[pos..];
                    // 仅处理未压缩的 UTF-8 文本
                    if let Ok(value) = String::from_utf8(text_data.to_vec()) {
                        text_chunks.insert(key, value);
                    }
                }
            }
        } else if chunk_type != "IDAT" && chunk_type != "IEND" {
            // 扫描所有非图像数据、非结束标记的 chunk，覆盖更多 C2PA/JUMBF 实现
            let scan_len = data.len().min(8192);
            c2pa_raw.extend_from_slice(&data[..scan_len]);
        }

        // IEND 是 PNG 最后一个 chunk，遇到即停止
        if chunk_type == "IEND" {
            break;
        }
    }

    // 先检测 C2PA/GPT-image（即使没有 tEXt chunk 也可能有 C2PA 数据）
    if let Some(meta) = detect_c2pa_gpt_image(&c2pa_raw, &text_chunks) {
        return Ok(meta);
    }

    parse_text_metadata(text_chunks, "PNG")
}
