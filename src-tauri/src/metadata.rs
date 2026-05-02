//! 图片元数据解析入口
//!
//! 按文件格式分派到 PNG / JPEG / WebP 解析器，并复用 A1111 / ComfyUI / NovelAI 的语义解析。

#[path = "metadata_jpeg.rs"]
mod metadata_jpeg;
#[path = "metadata_png.rs"]
mod metadata_png;
#[path = "metadata_webp.rs"]
mod metadata_webp;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

pub use metadata_jpeg::parse_jpeg_metadata;
pub use metadata_png::parse_png_metadata;
pub use metadata_webp::parse_webp_metadata;

/// 从图片中解析出的图片元数据
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
    pub parameter_groups: Vec<ParameterGroup>, // 按生成阶段/节点分组的参数
    pub source: String,           // 来源类型："a1111" / "comfyui" / "novelai" / "gpt-image" / "unknown"
    pub characters: Vec<CharacterPrompt>, // NovelAI v4 角色级提示词
    pub raw: HashMap<String, String>,     // 原始 key-value 数据
}

/// NovelAI v4 角色提示词结构
/// 包含角色描述文本和在画面中的中心坐标
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct CharacterPrompt {
    pub caption: String,          // 角色描述文本
    pub centers: Vec<(f64, f64)>, // 角色在画面中的归一化坐标 (x, y)
}

/// 生成参数分组，保留 ComfyUI 节点和 A1111 Hires fix 等阶段信息。
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ParameterGroup {
    pub title: String,
    pub params: Vec<ParameterItem>,
}

/// 单个生成参数键值。
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ParameterItem {
    pub label: String,
    pub value: String,
}

/// 根据文件扩展名分派元数据解析器。
pub fn parse_image_metadata(path: &Path) -> Result<ImageMetadata, String> {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    match ext.as_str() {
        "png" => parse_png_metadata(path),
        "jpg" | "jpeg" => parse_jpeg_metadata(path),
        "webp" => parse_webp_metadata(path),
        _ => Err("Unsupported image format".to_string()),
    }
}

/// 从容器文本字段中统一识别来源并返回结构化元数据。
pub fn parse_text_metadata(text_chunks: HashMap<String, String>, fallback_source: &str) -> Result<ImageMetadata, String> {
    if text_chunks.is_empty() {
        return Err(format!("No metadata found in {}", fallback_source));
    }

    if let Some(parameters) = text_chunks.get("parameters").cloned() {
        return Ok(parse_a1111_metadata(&parameters, &text_chunks));
    }

    if text_chunks.contains_key("prompt") || text_chunks.contains_key("workflow") {
        return Ok(parse_comfyui_metadata(&text_chunks));
    }

    if text_chunks.contains_key("Description") || text_chunks.contains_key("Comment") {
        return Ok(parse_novelai_metadata(&text_chunks));
    }

    let mut meta = ImageMetadata::default();
    meta.source = "unknown".to_string();
    meta.raw = text_chunks.clone();
    meta.prompt = text_chunks.values().cloned().collect::<Vec<_>>().join(" ");
    Ok(meta)
}

/// 判断文本是否像 Stable Diffusion 生成参数。
pub fn looks_like_generation_params(value: &str) -> bool {
    let value = value.to_lowercase();
    (value.contains("steps:") && value.contains("sampler:"))
        || value.contains("negative prompt:")
        || value.contains("cfg scale:")
        || value.contains("seed:")
        || value.contains("size:")
        || value.contains("model:")
}

/// 将 EXIF / 文本元数据写入 map，并在检测到生成参数时补充 `parameters` 键。
pub(crate) fn insert_detected_text(text_chunks: &mut HashMap<String, String>, key: &str, value: String) {
    let value = clean_metadata_text(&value);
    if value.is_empty() {
        return;
    }

    if looks_like_generation_params(&value) {
        text_chunks.entry("parameters".to_string()).or_insert_with(|| value.clone());
    }
    text_chunks.entry(key.to_string()).or_insert(value);
}

/// 统一清理 EXIF / 容器文本前缀，避免 A1111 参数前混入不可见标记。
pub(crate) fn clean_metadata_text(value: &str) -> String {
    value
        .trim_start_matches("ASCII\0\0\0")
        .trim_start_matches("UNICODE\0")
        .trim_start_matches("JIS\0\0\0\0\0")
        .trim_matches(char::from(0))
        .trim()
        .to_string()
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

    // JPEG / EXIF 中换行可能被工具改写，不能只匹配 "\nNegative prompt:"。
    if let Some(neg_pos) = parameters.find("Negative prompt:") {
        meta.prompt = parameters[..neg_pos].trim().to_string();
        let neg_and_rest = &parameters[neg_pos + "Negative prompt:".len()..];
        let steps_pos = neg_and_rest.find("Steps:");
        meta.negative_prompt = steps_pos
            .map(|pos| neg_and_rest[..pos].trim())
            .unwrap_or_else(|| neg_and_rest.trim())
            .trim_start_matches(',')
            .trim()
            .to_string();

        if let Some(pos) = steps_pos {
            apply_a1111_params(&mut meta, &format!("Steps:{}", &neg_and_rest[pos + "Steps:".len()..]));
        }
    } else if let Some(steps_pos) = parameters.find("Steps:") {
        meta.prompt = parameters[..steps_pos].trim().to_string();
        apply_a1111_params(&mut meta, &parameters[steps_pos..]);
    } else {
        meta.prompt = parameters.trim().to_string();
    }

    meta
}

fn apply_a1111_params(meta: &mut ImageMetadata, params_str: &str) {
    let params = parse_a1111_params(params_str);
    meta.steps = params.get("Steps").and_then(|v| v.parse().ok());
    meta.sampler = params.get("Sampler").cloned().unwrap_or_default();
    meta.cfg_scale = params.get("CFG scale").and_then(|v| v.parse().ok());
    meta.seed = params.get("Seed").and_then(|v| v.parse().ok());
    meta.model = params.get("Model").cloned().unwrap_or_default();
    // Size 格式为 "WxH"
    meta.width = params.get("Size").and_then(|s| s.split('x').next()?.parse().ok());
    meta.height = params.get("Size").and_then(|s| s.split('x').nth(1)?.parse().ok());
    meta.parameter_groups = build_a1111_parameter_groups(&params);
}

/// 解析 A1111 参数字符串为 key-value 映射
///
/// 逐字扫描 `key: value`，只把逗号后出现已知参数键名的片段识别为新字段，避免 TIPO JSON / prompt 中的冒号误拆。
fn parse_a1111_params(params_str: &str) -> HashMap<String, String> {
    let keys = a1111_param_keys();
    let mut positions: Vec<(usize, &str)> = keys
        .iter()
        .filter_map(|key| find_param_key(params_str, key).map(|pos| (pos, *key)))
        .collect();
    positions.sort_by_key(|(pos, _)| *pos);
    positions.dedup_by_key(|(pos, _)| *pos);

    let mut params = HashMap::new();
    for (idx, (start, key)) in positions.iter().enumerate() {
        let value_start = start + key.len() + 1;
        let value_end = positions.get(idx + 1).map(|(pos, _)| trim_param_separator(params_str, *pos)).unwrap_or(params_str.len());
        if value_start <= value_end && value_end <= params_str.len() {
            let value = params_str[value_start..value_end].trim().trim_matches(',').trim();
            if !value.is_empty() {
                params.insert((*key).to_string(), value.to_string());
            }
        }
    }

    params
}

fn a1111_param_keys() -> &'static [&'static str] {
    &[
        "Steps", "Sampler", "Schedule type", "CFG scale", "Seed", "Size", "Model hash", "Model",
        "Denoising strength", "Clip skip", "Style Selector Enabled", "Style Selector Randomize", "Style Selector Style",
        "ADetailer model", "ADetailer confidence", "ADetailer dilate erode", "ADetailer mask blur",
        "ADetailer denoising strength", "ADetailer inpaint only masked", "ADetailer inpaint padding",
        "ADetailer use inpaint width height", "ADetailer inpaint width", "ADetailer inpaint height", "ADetailer version",
        "Wildcard prompt", "TIPO Parameters", "TIPO prompt", "TIPO nl prompt", "TIPO format",
        "Hires upscale", "Hires steps", "Hires upscaler", "Hires resize", "Hires prompt", "Hires negative prompt",
        "Lora hashes", "Emphasis", "Pad conds", "Version",
    ]
}

fn find_param_key(text: &str, key: &str) -> Option<usize> {
    let pattern = format!("{}:", key);
    let mut search_start = 0;
    while let Some(relative) = text[search_start..].find(&pattern) {
        let pos = search_start + relative;
        let before = text[..pos].chars().rev().find(|ch| !ch.is_whitespace());
        if pos == 0 || before == Some(',') || before == Some('\n') || before == Some('\r') {
            return Some(pos);
        }
        search_start = pos + pattern.len();
    }
    None
}

fn trim_param_separator(text: &str, next_pos: usize) -> usize {
    text[..next_pos]
        .trim_end()
        .trim_end_matches(',')
        .trim_end()
        .len()
}

/// 将 A1111 参数按普通生成和 Hires fix 分组。
fn build_a1111_parameter_groups(params: &HashMap<String, String>) -> Vec<ParameterGroup> {
    let generation_keys = ["Steps", "Sampler", "Schedule type", "CFG scale", "Seed", "Size", "Model hash", "Model", "Clip skip"];
    let hires_keys = [
        "Hires upscale", "Hires upscaler", "Hires steps", "Hires resize", "Hires prompt",
        "Hires negative prompt", "Denoising strength", "First pass size",
    ];
    let adetailer_keys = [
        "ADetailer model", "ADetailer confidence", "ADetailer dilate erode", "ADetailer mask blur",
        "ADetailer denoising strength", "ADetailer inpaint only masked", "ADetailer inpaint padding",
        "ADetailer use inpaint width height", "ADetailer inpaint width", "ADetailer inpaint height", "ADetailer version",
    ];
    let tipo_keys = ["TIPO Parameters", "TIPO prompt", "TIPO nl prompt", "TIPO format", "Wildcard prompt"];
    let extra_keys = ["Style Selector Enabled", "Style Selector Randomize", "Style Selector Style", "Lora hashes", "Emphasis", "Pad conds", "Version"];

    let generation = build_param_group("Generation", &generation_keys, params);
    let hires = build_param_group("Hires fix", &hires_keys, params);
    let adetailer = build_param_group("ADetailer", &adetailer_keys, params);
    let tipo = build_param_group("TIPO", &tipo_keys, params);
    let extra = build_param_group("Extra", &extra_keys, params);

    [generation, hires, adetailer, tipo, extra]
        .into_iter()
        .filter(|group| !group.params.is_empty())
        .collect()
}

/// 按指定 key 顺序构造参数分组。
fn build_param_group(title: &str, keys: &[&str], params: &HashMap<String, String>) -> ParameterGroup {
    ParameterGroup {
        title: title.to_string(),
        params: keys
            .iter()
            .filter_map(|key| {
                params.get(*key).filter(|value| !value.is_empty()).map(|value| ParameterItem {
                    label: (*key).to_string(),
                    value: value.clone(),
                })
            })
            .collect(),
    }
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

    let mut positive_ref: Option<String> = None;
    let mut negative_ref: Option<String> = None;

    let mut node_entries: Vec<(&String, &serde_json::Value)> = nodes.iter().collect();
    node_entries.sort_by_key(|(id, _)| id.parse::<u32>().unwrap_or(u32::MAX));

    for (node_id, node) in node_entries {
        let Some(class_type) = node.get("class_type").and_then(|v| v.as_str()) else { continue; };
        let Some(inputs) = node.get("inputs") else { continue; };

        match class_type {
            "KSampler" | "KSamplerAdvanced" => {
                parse_comfyui_sampler(inputs, meta);
                if positive_ref.is_none() {
                    positive_ref = parse_comfyui_node_ref(inputs.get("positive")).map(str::to_string);
                }
                if negative_ref.is_none() {
                    negative_ref = parse_comfyui_node_ref(inputs.get("negative")).map(str::to_string);
                }
            }
            "CheckpointLoaderSimple" | "UNETLoader" => parse_comfyui_model(inputs, meta),
            _ => {}
        }

        if let Some(group) = build_comfyui_parameter_group(node_id, class_type, inputs) {
            meta.parameter_groups.push(group);
        }
    }

    if let Some(node_id) = positive_ref.as_deref().and_then(|id| parse_comfyui_clip_text_by_id(nodes, id)) {
        meta.prompt = node_id.to_string();
    }
    if let Some(node_id) = negative_ref.as_deref().and_then(|id| parse_comfyui_clip_text_by_id(nodes, id)) {
        meta.negative_prompt = node_id.to_string();
    }

    // 完全没有 KSampler 引用时再回退到旧逻辑：按 CLIPTextEncode 出现顺序猜测正负向。
    // 一旦存在 KSampler 引用，就不要再按顺序猜，避免把正向 prompt 再误填到反向里。
    if positive_ref.is_none() && negative_ref.is_none() {
        for node in nodes.values() {
            parse_comfyui_node(node, meta);
        }
    }
}

/// 提取 ComfyUI 节点引用数组中的节点 ID，如 ["12", 0]。
fn parse_comfyui_node_ref(value: Option<&serde_json::Value>) -> Option<&str> {
    value?.as_array()?.first()?.as_str()
}

/// 根据节点 ID 提取对应 CLIPTextEncode 的文本内容。
///
/// 如果节点的 text 输入是字符串则直接返回；如果是节点引用（数组），
/// 则递归跟踪引用链直到找到实际的文本值。
/// 支持 "easy positive" / "easy negative" 等自定义文本节点。
fn parse_comfyui_clip_text_by_id<'a>(
    nodes: &'a serde_json::Map<String, serde_json::Value>,
    node_id: &str,
) -> Option<&'a str> {
    let node = nodes.get(node_id)?;
    let inputs = node.get("inputs")?;

    // 按优先级检查文本输入字段：text → positive → negative
    for key in &["text", "positive", "negative"] {
        if let Some(value) = inputs.get(*key) {
            // 直接字符串 → 返回
            if let Some(s) = value.as_str() {
                return Some(s);
            }
            // 节点引用（数组如 ["27", 0]）→ 递归跟踪
            if let Some(ref_node_id) = value.as_array().and_then(|a| a.first()).and_then(|v| v.as_str()) {
                if let Some(text) = parse_comfyui_clip_text_by_id(nodes, ref_node_id) {
                    return Some(text);
                }
            }
        }
    }
    None
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
    if meta.steps.is_none() {
        meta.steps = inputs.get("steps").and_then(|v| v.as_u64()).map(|v| v as u32);
    }
    if meta.cfg_scale.is_none() {
        meta.cfg_scale = inputs.get("cfg").and_then(|v| v.as_f64());
    }
    if meta.seed.is_none() {
        meta.seed = inputs.get("seed").and_then(|v| v.as_i64());
    }
    if meta.sampler.is_empty() {
        meta.sampler = inputs
            .get("sampler_name")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
    }
}

/// 将 ComfyUI 采样/高分/修复类节点参数按节点分组，避免多个采样节点互相覆盖。
fn build_comfyui_parameter_group(
    node_id: &str,
    class_type: &str,
    inputs: &serde_json::Value,
) -> Option<ParameterGroup> {
    let keys = [
        ("seed", "Seed"),
        ("steps", "Steps"),
        ("cfg", "CFG"),
        ("sampler_name", "Sampler"),
        ("scheduler", "Scheduler"),
        ("denoise", "Denoise"),
        ("width", "Width"),
        ("height", "Height"),
        ("upscale_by", "Upscale by"),
        ("upscale_model", "Upscale model"),
        ("model_name", "Model"),
        ("inpaint_width", "Inpaint width"),
        ("inpaint_height", "Inpaint height"),
        ("tile_width", "Tile width"),
        ("tile_height", "Tile height"),
    ];

    let params: Vec<ParameterItem> = keys
        .iter()
        .filter_map(|(key, label)| format_json_param(inputs.get(*key)).map(|value| ParameterItem {
            label: (*label).to_string(),
            value,
        }))
        .collect();

    if params.is_empty() {
        return None;
    }

    Some(ParameterGroup {
        title: format!("{} #{}", class_type, node_id),
        params,
    })
}

/// 将 JSON 参数转成适合前端展示的短文本，过滤节点引用数组。
fn format_json_param(value: Option<&serde_json::Value>) -> Option<String> {
    let value = value?;
    if value.as_array().is_some() || value.as_object().is_some() {
        return None;
    }
    if let Some(s) = value.as_str() {
        return (!s.is_empty()).then(|| s.to_string());
    }
    if value.is_null() {
        return None;
    }
    Some(value.to_string())
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
pub(crate) fn detect_c2pa_gpt_image(c2pa_raw: &[u8], text_chunks: &HashMap<String, String>) -> Option<ImageMetadata> {
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
