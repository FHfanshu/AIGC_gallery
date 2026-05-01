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

    // C2PA / GPT-image 检测已在函数开头执行，此处跳过

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
    let mut meta = ImageMetadata {
        source: "comfyui".to_string(),
        raw: raw.clone(),
        ..Default::default()
    };

    parse_comfyui_prompt(raw.get("prompt"), &mut meta);

    if meta.prompt.is_empty() {
        meta.prompt = raw
            .get("workflow")
            .map(|workflow| workflow.chars().take(200).collect())
            .unwrap_or_default();
    }

    meta
}

/// 解析 ComfyUI prompt JSON，避免主流程被多层 JSON 判断包裹。
fn parse_comfyui_prompt(prompt: Option<&String>, meta: &mut ImageMetadata) {
    let Some(prompt) = prompt else { return; };
    let Ok(workflow) = serde_json::from_str::<serde_json::Value>(prompt) else { return; };
    let Some(nodes) = workflow.as_object() else { return; };

    for node in nodes.values() {
        parse_comfyui_node(node, meta);
    }
}

/// 解析单个 ComfyUI 节点。
fn parse_comfyui_node(node: &serde_json::Value, meta: &mut ImageMetadata) {
    let Some(class_type) = node.get("class_type").and_then(|v| v.as_str()) else { return; };
    let Some(inputs) = node.get("inputs") else { return; };

    match class_type {
        "CLIPTextEncode" => parse_comfyui_clip(inputs, meta),
        "KSampler" | "KSamplerAdvanced" => parse_comfyui_sampler(inputs, meta),
        "CheckpointLoaderSimple" | "UNETLoader" => parse_comfyui_model(inputs, meta),
        _ => {}
    }
}

/// 提取 ComfyUI 文本编码节点中的提示词。
fn parse_comfyui_clip(inputs: &serde_json::Value, meta: &mut ImageMetadata) {
    let Some(text) = inputs.get("text").and_then(|v| v.as_str()) else { return; };

    // ComfyUI 原始 prompt 中通常第一个 CLIPTextEncode 为正向，第二个为反向。
    if meta.prompt.is_empty() {
        meta.prompt = text.to_string();
    } else if meta.negative_prompt.is_empty() {
        meta.negative_prompt = text.to_string();
    }
}

/// 提取 ComfyUI 采样参数。
fn parse_comfyui_sampler(inputs: &serde_json::Value, meta: &mut ImageMetadata) {
    meta.steps = inputs.get("steps").and_then(|v| v.as_u64()).map(|v| v as u32);
    meta.cfg_scale = inputs.get("cfg").and_then(|v| v.as_f64());
    meta.seed = inputs.get("seed").and_then(|v| v.as_i64());
    meta.sampler = inputs
        .get("sampler_name")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
}

/// 提取 ComfyUI 模型名称。
fn parse_comfyui_model(inputs: &serde_json::Value, meta: &mut ImageMetadata) {
    meta.model = inputs
        .get("ckpt_name")
        .or_else(|| inputs.get("unet_name"))
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
}

/// 解析 NovelAI 格式的元数据
///
/// - `Description` key：正向提示词
/// - `Comment` key：JSON，包含 prompt / uc (negative) / steps / scale / seed 等
/// - NovelAI v4：从 `v4_prompt.caption` 提取 base_caption 和角色级提示词
fn parse_novelai_metadata(raw: &HashMap<String, String>) -> ImageMetadata {
    let mut meta = ImageMetadata {
        source: "novelai".to_string(),
        raw: raw.clone(),
        prompt: raw.get("Description").cloned().unwrap_or_default(),
        ..Default::default()
    };

    parse_novelai_comment(raw.get("Comment"), &mut meta);
    meta
}

/// 解析 NovelAI Comment JSON，缺失或格式错误时保留 Description 后备提示词。
fn parse_novelai_comment(comment: Option<&String>, meta: &mut ImageMetadata) {
    let Some(comment) = comment else { return; };
    let Ok(params) = serde_json::from_str::<serde_json::Value>(comment) else { return; };

    parse_novelai_basic_params(&params, meta);
    parse_novelai_positive_v4(&params, meta);
    parse_novelai_negative_v4(&params, meta);
}

/// 提取 NovelAI 通用生成参数。
fn parse_novelai_basic_params(params: &serde_json::Value, meta: &mut ImageMetadata) {
    meta.prompt = params
        .get("prompt")
        .and_then(|v| v.as_str())
        .unwrap_or(&meta.prompt)
        .to_string();
    meta.negative_prompt = params
        .get("uc")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    meta.steps = params.get("steps").and_then(|v| v.as_u64()).map(|v| v as u32);
    meta.cfg_scale = params.get("scale").and_then(|v| v.as_f64());
    meta.seed = params.get("seed").and_then(|v| v.as_i64());
    meta.sampler = params
        .get("sampler")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    meta.width = params.get("width").and_then(|v| v.as_u64()).map(|v| v as u32);
    meta.height = params.get("height").and_then(|v| v.as_u64()).map(|v| v as u32);

    if let Some(model) = params.get("n_samples") {
        meta.model = format!("NovelAI ({})", model);
    }
}

/// 提取 NovelAI v4 正向结构化提示词。
fn parse_novelai_positive_v4(params: &serde_json::Value, meta: &mut ImageMetadata) {
    let Some(caption) = params
        .get("v4_prompt")
        .and_then(|v| v.get("caption"))
    else { return; };

    if let Some(base) = non_empty_str(caption.get("base_caption")) {
        meta.prompt = base.to_string();
    }

    meta.characters.extend(parse_character_prompts(caption));
}

/// 提取 NovelAI v4 反向结构化提示词。
fn parse_novelai_negative_v4(params: &serde_json::Value, meta: &mut ImageMetadata) {
    let Some(caption) = params
        .get("v4_negative_prompt")
        .and_then(|v| v.get("caption"))
    else { return; };

    if let Some(base) = non_empty_str(caption.get("base_caption")) {
        meta.negative_prompt = base.to_string();
    }

    let neg_chars: Vec<String> = parse_character_prompts(caption)
        .into_iter()
        .map(|character| character.caption)
        .filter(|caption| !caption.is_empty())
        .collect();

    if neg_chars.is_empty() {
        return;
    }

    if !meta.negative_prompt.is_empty() {
        meta.negative_prompt.push_str(", ");
    }
    meta.negative_prompt.push_str(&neg_chars.join(", "));
}

/// 解析 NovelAI 角色提示词数组。
fn parse_character_prompts(caption: &serde_json::Value) -> Vec<CharacterPrompt> {
    caption
        .get("char_captions")
        .and_then(|v| v.as_array())
        .map(|items| items.iter().map(parse_character_prompt).collect())
        .unwrap_or_default()
}

/// 解析单个 NovelAI 角色提示词。
fn parse_character_prompt(item: &serde_json::Value) -> CharacterPrompt {
    CharacterPrompt {
        caption: item
            .get("char_caption")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        centers: parse_character_centers(item),
    }
}

/// 解析 NovelAI 角色中心点。
fn parse_character_centers(item: &serde_json::Value) -> Vec<(f64, f64)> {
    item
        .get("centers")
        .and_then(|v| v.as_array())
        .map(|centers| {
            centers
                .iter()
                .filter_map(|center| {
                    let x = center.get("x")?.as_f64()?;
                    let y = center.get("y")?.as_f64()?;
                    Some((x, y))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// 获取非空字符串字段。
fn non_empty_str(value: Option<&serde_json::Value>) -> Option<&str> {
    value.and_then(|v| v.as_str()).filter(|s| !s.is_empty())
}

/// 检测 C2PA / GPT-image / GPT-4o 元数据
///
/// 扫描 PNG 非文本 chunk 的原始数据，查找 C2PA 标记。
/// GPT-image-2 刚上线早期部分文件仍可能写入 `gpt-4o` / `GPT-4o` / `4o` 相关字段，
/// 因此这里同时覆盖 OpenAI GPT-image 与 4o 系列标记。
/// 如果检测到，返回解析后的 ImageMetadata。
fn detect_c2pa_gpt_image(c2pa_raw: &[u8], text_chunks: &HashMap<String, String>) -> Option<ImageMetadata> {
    if c2pa_raw.is_empty() {
        return None;
    }

    // 在原始数据中搜索 OpenAI 系列生成图像的 C2PA 特征字符串
    let raw_str = String::from_utf8_lossy(c2pa_raw);
    let raw_lower = raw_str.to_lowercase();
    let has_gpt_image = raw_lower.contains("gpt-image") || raw_lower.contains("gpt_image");
    let has_gpt_4o = raw_lower.contains("gpt-4o")
        || raw_lower.contains("gpt_4o")
        || raw_lower.contains("gpt4o")
        || raw_lower.contains("4o");
    let has_openai = raw_lower.contains("openai");

    if !has_gpt_image && !(has_openai && has_gpt_4o) {
        return None;
    }

    let mut meta = ImageMetadata::default();
    meta.source = "gpt-image".to_string();
    meta.raw = text_chunks.clone();

    // 尝试从 C2PA 数据中提取版本信息
    // 格式示例：ActionsSoftwareAgentVersion "2.0"
    if let Some(version_start) = raw_lower.find("gpt-image").or_else(|| raw_lower.find("gpt_image")) {
        // gpt-image 后面可能跟版本号，如 "gpt-image-2" 或 "gpt-image 2.0"
        let after = &raw_str[version_start..];
        if let Some(ver_end) = after.find(|c: char| !c.is_alphanumeric() && c != '-' && c != '.' && c != '_') {
            let agent = &after[..ver_end.min(32)];
            meta.model = format!("GPT-image ({})", agent);
        } else {
            meta.model = "GPT-image".to_string();
        }
    } else if has_gpt_4o {
        meta.model = "GPT-4o / GPT-image".to_string();
    } else {
        meta.model = "GPT-image (OpenAI)".to_string();
    }

    // GPT-image 通常没有传统意义上的 prompt/negative_prompt
    // 但如果有 text_chunks 中的描述信息，可以使用
    meta.prompt = String::new();
    meta.negative_prompt = String::new();

    Some(meta)
}

/// 获取图片的宽高尺寸
pub fn get_image_dimensions(path: &Path) -> Result<(u32, u32), String> {
    let img = image::image_dimensions(path).map_err(|e| e.to_string())?;
    Ok(img)
}
