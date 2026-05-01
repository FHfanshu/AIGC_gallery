// 工具函数库 — 提供前端通用的辅助函数
// 包括样式类名拼接、图片路径转换、元数据解析、文本截断等

import { convertFileSrc } from '@tauri-apps/api/core';
import type { ImageMetadata, LoRAMetadata, NovelAIReferenceMetadata } from '../types';

/**
 * cn — 条件式 CSS 类名拼接工具
 * 过滤掉 falsy 值（false、undefined、null、空字符串），将剩余类名用空格连接
 * @param classes - 类名列表，支持条件表达式
 * @returns 拼接后的类名字符串
 */
export function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

/**
 * getImageSrc — 将本地文件路径转换为 Tauri 可加载的资源 URL
 * Tauri 前端无法直接使用本地路径加载图片，需通过 convertFileSrc 转换
 * @param path - 本地文件路径
 * @returns 可用于 <img src> 的 URL 字符串，无效路径返回空字符串
 */
export function getImageSrc(path: string | null | undefined): string {
  if (!path) return '';
  try {
    return convertFileSrc(path);
  } catch {
    return '';  // 转换失败时返回空字符串，避免页面报错
  }
}

/**
 * parseMetadata — 解析图片元数据 JSON 字符串
 * @param json - 元数据的 JSON 字符串
 * @returns 解析后的对象，解析失败返回 null
 */
export function parseMetadata(json: string): ImageMetadata | null {
  try {
    const meta = JSON.parse(json) as ImageMetadata;
    return enrichModelMetadata(meta);
  } catch {
    return null;
  }
}

function enrichModelMetadata(meta: ImageMetadata): ImageMetadata {
  if (!meta.loras) meta.loras = [];
  if (!meta.model_hash) meta.model_hash = extractModelHash(meta);
  meta.loras = mergeLoras([...meta.loras, ...extractLoras(meta)]);
  meta.novelai = extractNovelAIExtendedMetadata(meta);
  return meta;
}

function numberArray(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === 'number') : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim()) : [];
}

function parseNovelAIComment(meta: ImageMetadata): Record<string, any> | null {
  const comment = meta.raw?.Comment;
  if (!comment) return null;
  try {
    const parsed = JSON.parse(comment);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function buildNovelAIReference(
  kind: NovelAIReferenceMetadata['kind'],
  label: string,
  descriptions: unknown,
  strengths: unknown,
  information: unknown,
  secondary: unknown,
): NovelAIReferenceMetadata | null {
  const item = {
    kind,
    label,
    descriptions: stringArray(descriptions),
    strengths: numberArray(strengths),
    information_extracted: numberArray(information),
    secondary_strengths: numberArray(secondary),
  };
  const hasData = item.descriptions.length > 0
    || item.strengths.length > 0
    || item.information_extracted.length > 0
    || item.secondary_strengths.length > 0;
  return hasData ? item : null;
}

function extractNovelAIExtendedMetadata(meta: ImageMetadata): ImageMetadata['novelai'] | undefined {
  if (meta.source !== 'novelai') return undefined;
  const raw = meta.raw ?? {};
  const comment = parseNovelAIComment(meta);
  const extra = comment?.extra_passthrough_testing && typeof comment.extra_passthrough_testing === 'object'
    ? comment.extra_passthrough_testing
    : {};
  const references = [
    buildNovelAIReference(
      'character',
      'Character Reference',
      comment?.reference_descriptions_multiple,
      comment?.reference_strength_multiple,
      comment?.reference_information_extracted_multiple,
      null,
    ),
    buildNovelAIReference(
      'vibe',
      'Vibe Reference',
      comment?.director_reference_descriptions ?? extra.director_reference_descriptions,
      comment?.director_reference_strengths ?? extra.director_reference_strengths,
      comment?.director_reference_information_extracted ?? extra.director_reference_information_extracted,
      comment?.director_reference_secondary_strengths ?? extra.director_reference_secondary_strengths,
    ),
    buildNovelAIReference(
      'director',
      'Director Reference',
      extra.director_reference_descriptions,
      extra.director_reference_strengths,
      extra.director_reference_information_extracted,
      extra.director_reference_secondary_strengths,
    ),
  ].filter(Boolean) as NovelAIReferenceMetadata[];

  return {
    software: raw.Software,
    source: raw.Source,
    generation_time: raw['Generation time'],
    signed_hash: typeof comment?.signed_hash === 'string' ? comment.signed_hash : undefined,
    request_type: typeof comment?.request_type === 'string' ? comment.request_type : undefined,
    negative_prompt: typeof comment?.uc === 'string' ? comment.uc : undefined,
    uncond_per_vibe: typeof comment?.uncond_per_vibe === 'boolean' ? comment.uncond_per_vibe : undefined,
    wonky_vibe_correlation: typeof comment?.wonky_vibe_correlation === 'boolean' ? comment.wonky_vibe_correlation : undefined,
    references,
  };
}


function mergeLoras(items: LoRAMetadata[]): LoRAMetadata[] {
  const map = new Map<string, LoRAMetadata>();
  for (const item of items) {
    const key = item.name.toLowerCase();
    const existing = map.get(key);
    if (!existing) {
      map.set(key, item);
      continue;
    }
    map.set(key, {
      name: existing.name || item.name,
      weight: existing.weight || item.weight,
      hash: existing.hash || item.hash,
    });
  }
  return [...map.values()];
}

function splitA1111Params(parameters: string | undefined): Record<string, string> {
  if (!parameters) return {};
  const lines = parameters.split('\n');
  const paramsLine = [...lines].reverse().find(line => /(^|,\s*)Steps:\s*/.test(line)) ?? parameters;
  const result: Record<string, string> = {};
  let token = '';
  let quoted = false;

  const pushToken = () => {
    const idx = token.indexOf(':');
    if (idx > 0) {
      const key = token.slice(0, idx).trim();
      const value = token.slice(idx + 1).trim().replace(/^"|"$/g, '');
      if (key) result[key] = value;
    }
    token = '';
  };

  for (const char of paramsLine) {
    if (char === '"') quoted = !quoted;
    if (char === ',' && !quoted) {
      pushToken();
    } else {
      token += char;
    }
  }
  pushToken();
  return result;
}

function extractModelHash(meta: ImageMetadata): string | undefined {
  const raw = meta.raw ?? {};
  const params = splitA1111Params(raw.parameters);
  return raw['Model hash']
    || raw['model_hash']
    || raw['Checkpoint hash']
    || params['Model hash']
    || params['Checkpoint hash']
    || undefined;
}

function extractLoraHashText(raw: Record<string, string>): string {
  if (raw['Lora hashes'] || raw['LoRA hashes']) return raw['Lora hashes'] || raw['LoRA hashes'];
  const params = splitA1111Params(raw.parameters);
  return params['Lora hashes']
    || params['LoRA hashes']
    || '';
}

function extractLoras(meta: ImageMetadata): LoRAMetadata[] {
  const raw = meta.raw ?? {};
  const out: LoRAMetadata[] = [];

  const hashText = extractLoraHashText(raw);
  if (hashText) {
    for (const chunk of hashText.split(/,\s*/)) {
      const match = chunk.match(/^(.+?):\s*((?:0x)?[0-9a-fA-F]+)$/);
      const name = match?.[1]?.trim();
      const hash = match?.[2]?.trim();
      if (name) out.push({ name, hash });
    }
  }

  const promptSources = [meta.prompt, raw['prompt'], raw['Description']].filter(Boolean) as string[];
  const hashByName = new Map(out.map(item => [item.name.toLowerCase(), item.hash]));
  for (const text of promptSources) {
    const regex = /<lora:([^:>]+)(?::([^>]+))?>/gi;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const name = match[1].trim();
      out.push({ name, weight: match[2]?.trim(), hash: hashByName.get(name.toLowerCase()) });
    }
  }

  const comfy = raw['prompt'] || raw['workflow'];
  if (comfy) {
    try {
      const workflow = JSON.parse(comfy);
      for (const node of Object.values(workflow as Record<string, any>)) {
        const classType = node?.class_type;
        const inputs = node?.inputs;
        if (!classType || !inputs) continue;
        if (typeof classType === 'string' && /lora/i.test(classType)) {
          const name = inputs.lora_name || inputs.ckpt_name || inputs.model_name;
          if (typeof name === 'string' && name.trim()) {
            out.push({
              name: name.trim(),
              weight: typeof inputs.strength_model === 'number' ? String(inputs.strength_model) : undefined,
              hash: typeof inputs.hash === 'string' ? inputs.hash : undefined,
            });
          }
        }
      }
    } catch {
      // 不是 JSON 工作流时忽略
    }
  }

  return out;
}

/**
 * truncate — 文本截断工具
 * 超过指定长度时截断并添加省略号
 * @param str - 原始字符串
 * @len - 最大保留长度
 * @returns 截断后的字符串
 */
export function truncate(str: string, len: number): string {
  return str.length > len ? str.slice(0, len) + '...' : str;
}

/**
 * getSourceLabel — 根据图片来源类型返回显示标签和对应颜色
 * 用于在图库中用不同颜色标识不同 AI 生成工具的来源
 * @param source - 来源标识（如 "a1111"、"comfyui"、"novelai"）
 * @returns 包含 label（显示名称）和 color（十六进制色值）的对象
 */
export function getSourceLabel(source: string): { label: string; color: string } {
  const map: Record<string, { label: string; color: string }> = {
    a1111: { label: 'A1111', color: '#22c55e' },       // 绿色 — Stable Diffusion WebUI
    comfyui: { label: 'ComfyUI', color: '#3b82f6' },   // 蓝色 — ComfyUI 节点式工具
    novelai: { label: 'NovelAI', color: '#f472b6' },   // 粉色 — NovelAI
    'gpt-image': { label: 'GPT', color: '#10b981' },   // 青绿色 — OpenAI GPT-image
    unknown: { label: 'Unknown', color: '#6b7280' },   // 灰色 — 未知来源
  };
  return map[source] || map.unknown;  // 未匹配时默认返回 Unknown
}

/**
 * debounce — 通用防抖函数
 * 在指定时间内多次调用只执行最后一次，常用于搜索输入等场景
 * @param fn - 需要防抖的目标函数
 * @param ms - 延迟毫秒数
 * @returns 包装后的防抖函数
 */
export function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout>;
  return ((...args: any[]) => {
    clearTimeout(timer);                    // 每次调用时清除上次定时器
    timer = setTimeout(() => fn(...args), ms);  // 重新设定延迟执行
  }) as T;
}
