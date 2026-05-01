//! PNG 元数据解析模块
//!
//! 从 PNG 文件的 tEXt / iTXt chunk 中提取 AI 绘图元数据。
//! 支持三种主流来源的自动检测与解析：
//! - **A1111 / Forge**：`parameters` 字段
//! - **ComfyUI**：`prompt` / `workflow` JSON
//! - **NovelAI**：`Description` + `Comment` JSON（含 v4 角色提示词）

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufReader, Read};
use std::path::Path;

/// 从 PNG 中解析出的图片元数据
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ImageMetadata {
    pub prompt: String,           // 正向提示词
    pub negative_prompt: String,  // 反向提示词
    pub model: String,            // 使用的模型名称
    pub sampler: String,          // 采样器名称
    pub steps: Option<u32>,       // 采样步数
    pub cfg_scale: Option<f64>,   // CFG 引导强度
    pub seed: Option<i64>,        // 随机种子
    pub width: Option<u32>,       // 图片宽度
    pub height: Option<u32>,      // 图片高度
    pub source: String,           // 来源类型："a1111" / "comfyui" / "novelai" / "unknown"
    pub characters: Vec<CharacterPrompt>, // NovelAI v4 角色级提示词
    pub raw: HashMap<String, String>,     // 原始 key-value 数据（保留完整 chunk）
}

/// NovelAI v4 角色提示词结构
/// 包含角色描述文本和在画面中的中心坐标
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct CharacterPrompt {
    pub caption: String,               // 角色描述文本
    pub centers: Vec<(f64, f64)>,      // 角色在画面中的归一化坐标 (x, y)
}

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

        let mut data = vec![0u8; length as usize];
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
        }

        // IEND 是 PNG 最后一个 chunk，遇到即停止
        if chunk_type == "IEND" {
            break;
        }
    }

    if text_chunks.is_empty() {
        return Err("No metadata found in PNG".to_string());
    }

    // 根据 key 特征自动检测来源，按优先级依次尝试
    if let Some(parameters) = text_chunks.get("parameters") {
        // A1111 / Forge：存在 "parameters" key
        return Ok(parse_a1111_metadata(parameters, &text_chunks));
    }

    if text_chunks.contains_key("prompt") || text_chunks.contains_key("workflow") {
        // ComfyUI：存在 "prompt" 或 "workflow" key
        return Ok(parse_comfyui_metadata(&text_chunks));
    }

    if text_chunks.contains_key("Description") || text_chunks.contains_key("Comment") {
        // NovelAI：存在 "Description" 或 "Comment" key
        return Ok(parse_novelai_metadata(&text_chunks));
    }

    // 未知格式：保留原始数据，将所有 value 拼接作为 prompt
    let mut meta = ImageMetadata::default();
    meta.source = "unknown".to_string();
    meta.raw = text_chunks.clone();
    meta.prompt = text_chunks.values().cloned().collect::<Vec<_>>().join(" ");
    Ok(meta)
}

/// 解析 A1111 / Forge 格式的 parameters 字段
///
/// 格式示例：
/// ```text
/// positive prompt text
/// Negative prompt: negative prompt text
/// Steps: 20, Sampler: Euler a, CFG scale: 7, Seed: 12345, Size: 512x768, Model: xxx
/// ```
fn parse_a1111_metadata(parameters: &str, raw: &HashMap<String, String>) -> ImageMetadata {
    let mut meta = ImageMetadata::default();
    meta.source = "a1111".to_string();
    meta.raw = raw.clone();

    // 按 "\nNegative prompt:" 分割：前半部分为正向提示词
    let parts: Vec<&str> = parameters.split("\nNegative prompt:").collect();
    meta.prompt = parts[0].trim().to_string();

    if parts.len() > 1 {
        let neg_and_rest = parts[1];
        // 按 "\nSteps:" 分割：前半部分为反向提示词，后半部分为生成参数
        let rest_parts: Vec<&str> = neg_and_rest.split("\nSteps:").collect();
        meta.negative_prompt = rest_parts[0].trim().to_string();

        if rest_parts.len() > 1 {
            let params_str = format!("Steps:{}", rest_parts[1]);
            let params = parse_a1111_params(&params_str);
            meta.steps = params.get("Steps").and_then(|v| v.parse().ok());
            meta.sampler = params.get("Sampler").cloned().unwrap_or_default();
            meta.cfg_scale = params.get("CFG scale").and_then(|v| v.parse().ok());
            meta.seed = params.get("Seed").and_then(|v| v.parse().ok());
            meta.model = params.get("Model").cloned().unwrap_or_default();
            // Size 格式为 "WxH"
            meta.width = params.get("Size").and_then(|s| s.split('x').next()?.parse().ok());
            meta.height = params.get("Size").and_then(|s| s.split('x').nth(1)?.parse().ok());
        }
    }

    meta
}

/// 解析 A1111 参数字符串为 key-value 映射
///
/// 按 ", " 分割，但正确处理值中包含逗号的情况（如 "DPM++ 2M Karras"）
fn parse_a1111_params(params_str: &str) -> HashMap<String, String> {
    let mut params = HashMap::new();
    let mut current_key = String::new();
    let mut current_value = String::new();

    for part in params_str.split(", ") {
        if let Some(colon_pos) = part.find(':') {
            // 遇到新的 key:value 对，保存上一个
            if !current_key.is_empty() {
                params.insert(current_key.trim().to_string(), current_value.trim().to_string());
            }
            current_key = part[..colon_pos].to_string();
            current_value = part[colon_pos + 1..].to_string();
        } else {
            // 没有冒号说明是上一个 value 的延续（值中含逗号）
            current_value.push_str(", ");
            current_value.push_str(part);
        }
    }
    if !current_key.is_empty() {
        params.insert(current_key.trim().to_string(), current_value.trim().to_string());
    }

    params
}

/// 解析 ComfyUI 格式的 prompt JSON
///
/// 遍历工作流节点，从 class_type 识别关键节点：
/// - `CLIPTextEncode`：提取正向/反向提示词
/// - `KSampler` / `KSamplerAdvanced`：提取步数、CFG、种子、采样器
/// - `CheckpointLoaderSimple` / `UNETLoader`：提取模型名称
fn parse_comfyui_metadata(raw: &HashMap<String, String>) -> ImageMetadata {
    let mut meta = ImageMetadata::default();
    meta.source = "comfyui".to_string();
    meta.raw = raw.clone();

    if let Some(prompt_str) = raw.get("prompt") {
        if let Ok(workflow) = serde_json::from_str::<serde_json::Value>(prompt_str) {
            if let Some(obj) = workflow.as_object() {
                for (_key, node) in obj {
                    if let Some(class_type) = node.get("class_type").and_then(|v| v.as_str()) {
                        if let Some(inputs) = node.get("inputs") {
                            match class_type {
                                "CLIPTextEncode" => {
                                    if let Some(text) = inputs.get("text").and_then(|v| v.as_str()) {
                                        // 启发式：第一个 CLIP 节点为正向，第二个为反向
                                        if meta.prompt.is_empty() {
                                            meta.prompt = text.to_string();
                                        } else {
                                            meta.negative_prompt = text.to_string();
                                        }
                                    }
                                }
                                "KSampler" | "KSamplerAdvanced" => {
                                    meta.steps = inputs.get("steps").and_then(|v| v.as_u64()).map(|v| v as u32);
                                    meta.cfg_scale = inputs.get("cfg").and_then(|v| v.as_f64());
                                    meta.seed = inputs.get("seed").and_then(|v| v.as_i64());
                                    meta.sampler = inputs.get("sampler_name")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("")
                                        .to_string();
                                }
                                "CheckpointLoaderSimple" | "UNETLoader" => {
                                    // 优先 ckpt_name，回退到 unet_name
                                    meta.model = inputs.get("ckpt_name")
                                        .or_else(|| inputs.get("unet_name"))
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("")
                                        .to_string();
                                }
                                _ => {}
                            }
                        }
                    }
                }
            }
        }
    }

    // 如果 prompt 节点中没找到提示词，尝试从 workflow JSON 截取
    if meta.prompt.is_empty() {
        if let Some(workflow_str) = raw.get("workflow") {
            meta.prompt = workflow_str.chars().take(200).collect();
        }
    }

    meta
}

/// 解析 NovelAI 格式的元数据
///
/// - `Description` key：正向提示词
/// - `Comment` key：JSON，包含 prompt / uc (negative) / steps / scale / seed 等
/// - NovelAI v4：从 `v4_prompt.caption` 提取 base_caption 和角色级提示词
fn parse_novelai_metadata(raw: &HashMap<String, String>) -> ImageMetadata {
    let mut meta = ImageMetadata::default();
    meta.source = "novelai".to_string();
    meta.raw = raw.clone();

    // Description 字段作为正向提示词的后备值
    if let Some(desc) = raw.get("Description") {
        meta.prompt = desc.clone();
    }

    if let Some(comment) = raw.get("Comment") {
        if let Ok(params) = serde_json::from_str::<serde_json::Value>(comment) {
            // 基础参数提取
            meta.prompt = params.get("prompt")
                .and_then(|v| v.as_str())
                .unwrap_or(&meta.prompt)
                .to_string();
            meta.negative_prompt = params.get("uc")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            meta.steps = params.get("steps").and_then(|v| v.as_u64()).map(|v| v as u32);
            meta.cfg_scale = params.get("scale").and_then(|v| v.as_f64());
            meta.seed = params.get("seed").and_then(|v| v.as_i64());
            meta.sampler = params.get("sampler")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            meta.width = params.get("width").and_then(|v| v.as_u64()).map(|v| v as u32);
            meta.height = params.get("height").and_then(|v| v.as_u64()).map(|v| v as u32);

            // NovelAI 模型信息（n_samples 字段标识模型版本）
            if let Some(model) = params.get("n_samples") {
                meta.model = format!("NovelAI ({})", model);
            }

            // NovelAI v4：提取结构化角色提示词
            // v4_prompt → caption → base_caption + char_captions
            if let Some(v4_prompt) = params.get("v4_prompt") {
                if let Some(caption) = v4_prompt.get("caption") {
                    // base_caption 覆盖顶层 prompt
                    if let Some(base) = caption.get("base_caption").and_then(|v| v.as_str()) {
                        if !base.is_empty() {
                            meta.prompt = base.to_string();
                        }
                    }
                    // 提取每个角色的描述文本和中心坐标
                    if let Some(char_captions) = caption.get("char_captions").and_then(|v| v.as_array()) {
                        for cc in char_captions {
                            let char_caption = cc.get("char_caption")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            let centers = cc.get("centers")
                                .and_then(|v| v.as_array())
                                .map(|arr| {
                                    arr.iter()
                                        .filter_map(|c| {
                                            let x = c.get("x")?.as_f64()?;
                                            let y = c.get("y")?.as_f64()?;
                                            Some((x, y))
                                        })
                                        .collect()
                                })
                                .unwrap_or_default();
                            meta.characters.push(CharacterPrompt {
                                caption: char_caption,
                                centers,
                            });
                        }
                    }
                }
            }

            // NovelAI v4 反向提示词：从 v4_negative_prompt.caption.base_caption 提取
            if let Some(v4_uc) = params.get("v4_negative_prompt") {
                if let Some(caption) = v4_uc.get("caption") {
                    if let Some(base) = caption.get("base_caption").and_then(|v| v.as_str()) {
                        if !base.is_empty() {
                            meta.negative_prompt = base.to_string();
                        }
                    }
                    // 将反向角色提示词追加到 negative_prompt
                    if let Some(char_captions) = caption.get("char_captions").and_then(|v| v.as_array()) {
                        let neg_chars: Vec<String> = char_captions
                            .iter()
                            .filter_map(|cc| cc.get("char_caption")?.as_str().map(|s| s.to_string()))
                            .collect();
                        if !neg_chars.is_empty() {
                            let existing = if meta.negative_prompt.is_empty() { String::new() } else { format!("{}, ", meta.negative_prompt) };
                            meta.negative_prompt = format!("{}{}", existing, neg_chars.join(", "));
                        }
                    }
                }
            }
        }
    }

    meta
}

/// 获取图片的宽高尺寸
pub fn get_image_dimensions(path: &Path) -> Result<(u32, u32), String> {
    let img = image::image_dimensions(path).map_err(|e| e.to_string())?;
    Ok(img)
}
