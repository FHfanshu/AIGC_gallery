// 类型定义文件 — 定义前端全局共享的数据结构接口与类型别名

/**
 * 图片记录 — 对应后端数据库中的一条图片元数据
 * 包含文件路径、尺寸、提示词、标签、收藏状态等完整信息
 */
export interface ImageRecord {
  id: number;                    // 数据库主键 ID
  file_path: string;             // 原始文件路径
  stored_path: string | null;    // 应用内部存储路径（可为空）
  file_name: string;             // 文件名
  file_hash: string;             // 文件内容哈希，用于去重
  width: number;                 // 图片宽度（像素）
  height: number;                // 图片高度（像素）
  source_type: string;           // 来源类型（如 "import"、"download" 等）
  thumbnail_path: string | null; // 缩略图路径（可为空）
  prompt: string;                // 正向提示词（AI 生成图的 prompt）
  negative_prompt: string;       // 反向提示词（negative prompt）
  metadata_json: string;         // 完整元数据的 JSON 字符串
  created_at: string;            // 创建时间（ISO 格式字符串）
  tags: string[];                // 关联的标签列表
  storage_mode: string;          // 存储模式：copy / hardlink
  is_favorite: boolean;          // 是否已收藏
}

/**
 * 图片统计信息 — 用于仪表盘展示图库概览
 */
export interface ImageStats {
  total_images: number;                              // 图片总数
  total_tags: number;                                // 标签总数
  models: { model: string; count: number }[];        // 各模型及其对应图片数量
}

/**
 * 图片元数据 — 从元数据 JSON 中解析出的结构化信息
 * 主要用于 AI 生成图片的参数展示
 */
export interface ImageMetadata {
  prompt: string;               // 正向提示词
  negative_prompt: string;      // 反向提示词
  model: string;                // 使用的模型名称
  model_hash?: string;          // Checkpoint 哈希，部分来源才提供
  loras?: LoRAMetadata[];       // LoRA 模型列表，部分来源才提供
  novelai?: NovelAIExtendedMetadata; // NovelAI 专属扩展字段
  sampler: string;              // 采样器名称
  steps: number | null;         // 采样步数
  cfg_scale: number | null;     // CFG 引导强度
  seed: number | null;          // 随机种子
  width: number | null;         // 生成宽度
  height: number | null;        // 生成高度
  source: string;               // 来源工具（如 "stable-diffusion"）
  characters: CharacterPrompt[]; // 角色提示词列表
  raw: Record<string, string>;  // 原始未解析的键值对
}

export interface LoRAMetadata {
  name: string;                   // LoRA 名称
  weight?: string;                // prompt 或节点中的权重
  hash?: string;                  // LoRA 哈希，部分来源才提供
}

export interface NovelAIReferenceMetadata {
  kind: 'character' | 'vibe' | 'director';
  label: string;
  descriptions: string[];
  strengths: number[];
  information_extracted: number[];
  secondary_strengths: number[];
}

export interface NovelAIExtendedMetadata {
  software?: string;
  source?: string;
  signed_hash?: string;
  request_type?: string;
  generation_time?: string;
  negative_prompt?: string;
  uncond_per_vibe?: boolean;
  wonky_vibe_correlation?: boolean;
  references: NovelAIReferenceMetadata[];
}

/**
 * 角色提示词 — 描述图片中某个角色及其位置信息
 */
export interface CharacterPrompt {
  caption: string;                // 角色描述文本
  centers: [number, number][];   // 角色中心点坐标数组 [x, y]
}

/**
 * 导入结果 — 批量导入图片后的执行结果汇总
 */
export interface ImportResult {
  success: string[];   // 成功导入的文件列表
  skipped: string[];   // 因重复等原因跳过的文件列表
  errors: string[];    // 导入失败的文件列表（含错误信息）
}

/** 视图类型 — 控制主界面当前显示的页面 */
export interface StorageConfig {
  storage_dir: string | null;
  resolved_dir: string;
  import_strategy: 'copy' | 'hardlink_then_copy';
  civitai_base_url: 'https://civitai.com' | 'https://civitai.green' | 'https://civitai.red';
}

export type ImportStrategy = StorageConfig['import_strategy'];
export type CivitaiBaseUrl = StorageConfig['civitai_base_url'];

export interface CivitaiKeyStatus {
  has_key: boolean;
}

export interface CivitaiLookupResult {
  model_version_id: number | null;
  model_id: number | null;
  version_name: string | null;
  model_name: string | null;
  model_type: string | null;
  nsfw: unknown;
  trained_words: string[];
  raw: unknown;
}

export type ViewType = 'gallery' | 'favorites' | 'settings';
