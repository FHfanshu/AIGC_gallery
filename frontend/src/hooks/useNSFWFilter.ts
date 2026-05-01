// NSFW 内容过滤 Hook
// 基于提示词标签匹配实现 NSFW 图片过滤，支持自定义标签列表
// 标签和过滤开关状态持久化到 localStorage

import { useState, useCallback } from 'react';
import { parseMetadata } from '../lib/utils';

/** localStorage 存储键：NSFW 标签列表 */
const STORAGE_KEY = 'nsfwTags';
/** localStorage 存储键：手动隐藏的图片 ID 列表 */
const HIDDEN_IDS_KEY = 'nsfwHiddenImageIds';

/** localStorage 存储键：是否隐藏 NSFW */
const HIDE_KEY = 'hideNSFW';

/** 默认 NSFW 关键词列表（常见英文敏感词） */
const DEFAULT_NSFW_TAGS = [
  'nsfw', 'nude', 'naked', 'sex', 'porn', 'hentai', 'erotic',
  'explicit', 'rating explicit', 'rating:explicit', 'adult',
  'topless', 'bottomless', 'genital', 'breast', 'breasts',
  'pussy', 'penis', 'orgasm', 'masturbation', 'fellatio',
  'cunnilingus', 'intercourse', 'vaginal', 'anal', 'bondage',
  'fetish', 'lingerie', 'underwear',
];

/** 包含提示词信息的图片接口（最小化约束） */
interface PromptLikeImage {
  id: number;
  prompt?: string | null;
  metadata_json?: string | null;
}

/**
 * 标签标准化：小写化、去除括号/权重/下划线、合并空格
 * 例如 "1girl_(anime)" → "1girl anime"
 */
function normalizeTag(tag: string): string {
  return tag
    .toLowerCase()
    .replace(/\\[()\[\]{}]/g, '')   // 转义的括号
    .replace(/[()\[\]{}]/g, '')     // 普通括号
    .replace(/:[\d.]+$/g, '')       // 权重后缀如 ":1.2"
    .replace(/_/g, ' ')             // 下划线转空格
    .replace(/\s+/g, ' ')           // 合并多余空格
    .trim();
}

/**
 * 从 localStorage 加载 NSFW 标签集合
 * 首次使用时初始化为默认列表并持久化
 */
function loadNSFWTags(): Set<string> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return new Set(parsed.map(t => normalizeTag(String(t))).filter(Boolean));
      }
    }
  } catch {}

  // 首次使用：写入默认标签列表
  const defaults = DEFAULT_NSFW_TAGS.map(normalizeTag).filter(Boolean);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(defaults));
  return new Set(defaults);
}

/**
 * 从图片中提取完整的提示词文本
 * 合并 prompt、metadata_json.prompt 和角色级 caption
 */
function extractPromptText(image: PromptLikeImage): string {
  const parts: string[] = [];
  if (image.prompt) parts.push(image.prompt);

  const meta = image.metadata_json ? parseMetadata(image.metadata_json) : null;
  // 避免重复添加已有的 prompt
  if (meta?.prompt && meta.prompt !== image.prompt) parts.push(meta.prompt);

  // NovelAI v4 角色级提示词也纳入匹配范围
  if (Array.isArray(meta?.characters)) {
    for (const character of meta.characters) {
      if (character?.caption) parts.push(character.caption);
    }
  }

  return parts.join(', ');
}

/** 将提示词文本按逗号/换行分割并标准化为标签数组 */
function extractPromptTags(prompt: string): string[] {
  return prompt
    .split(/[,\n]/g)
    .map(tag => normalizeTag(tag))
    .filter(Boolean);
}

/**
 * NSFW 过滤 Hook
 *
 * @returns hideNSFW - 是否启用过滤
 * @returns toggleNSFW - 切换过滤开关
 * @returns nsfwTags - 当前 NSFW 标签集合
 * @returns addNSFWTag / removeNSFWTag - 管理自定义标签
 * @returns filterImages - 过滤图片数组，移除匹配 NSFW 标签的图片
 */
export function useNSFWFilter() {
  // 从 localStorage 恢复过滤开关状态
  const [hideNSFW, setHideNSFW] = useState(() => localStorage.getItem(HIDE_KEY) === 'true');
  // 从 localStorage 恢复（或初始化）NSFW 标签集合
  const [nsfwTags, setNsfwTags] = useState<Set<string>>(loadNSFWTags);
  // 手动隐藏的图片 ID 集合
  const [hiddenImageIds, setHiddenImageIds] = useState<Set<number>>(() => {
    try {
      const stored = localStorage.getItem(HIDDEN_IDS_KEY);
      if (stored) return new Set(JSON.parse(stored));
    } catch {}
    return new Set();
  });

  // 切换 NSFW 过滤开关并持久化
  const toggleNSFW = useCallback(() => {
    setHideNSFW(prev => {
      const next = !prev;
      localStorage.setItem(HIDE_KEY, String(next));
      return next;
    });
  }, []);

  /** 判断单张图片是否为 NSFW（宁可误伤：提示词标签与 NSFW 关键词互相包含即命中） */
  const isNSFW = useCallback((image: PromptLikeImage): boolean => {
    const promptTags = extractPromptTags(extractPromptText(image));
    return promptTags.some(tag => {
      for (const nsfwTag of nsfwTags) {
        if (tag === nsfwTag || tag.includes(nsfwTag) || nsfwTag.includes(tag)) {
          return true;
        }
      }
      return false;
    });
  }, [nsfwTags]);

  /** 添加自定义 NSFW 标签并持久化 */
  const addNSFWTag = useCallback((tag: string) => {
    const normalized = normalizeTag(tag);
    if (!normalized) return;

    setNsfwTags(prev => {
      const next = new Set(prev);
      next.add(normalized);
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...next].sort()));
      return next;
    });
  }, []);

  /** 移除 NSFW 标签并持久化 */
  const removeNSFWTag = useCallback((tag: string) => {
    const normalized = normalizeTag(tag);
    setNsfwTags(prev => {
      const next = new Set(prev);
      next.delete(normalized);
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...next].sort()));
      return next;
    });
  }, []);

  /** 过滤图片数组：开启 NSFW 过滤时移除匹配的图片，始终移除手动隐藏的图片 */
  const filterImages = useCallback(<T extends PromptLikeImage>(images: T[]): T[] => {
    return images.filter(img => {
      // 手动隐藏的图片始终过滤
      if (hiddenImageIds.has(img.id)) return false;
      // 开启 NSFW 过滤时，匹配标签的图片也过滤
      if (hideNSFW && isNSFW(img)) return false;
      return true;
    });
  }, [hideNSFW, isNSFW, hiddenImageIds]);

  /** 手动标记图片为 NSFW（按 ID 隐藏） */
  const hideImage = useCallback((id: number) => {
    setHiddenImageIds(prev => {
      const next = new Set(prev);
      next.add(id);
      localStorage.setItem(HIDDEN_IDS_KEY, JSON.stringify([...next]));
      return next;
    });
  }, []);

  /** 取消手动隐藏 */
  const unhideImage = useCallback((id: number) => {
    setHiddenImageIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      localStorage.setItem(HIDDEN_IDS_KEY, JSON.stringify([...next]));
      return next;
    });
  }, []);

  /** 判断图片是否被手动隐藏 */
  const isImageHidden = useCallback((id: number) => hiddenImageIds.has(id), [hiddenImageIds]);

  return {
    hideNSFW,
    toggleNSFW,
    nsfwTags,
    addNSFWTag,
    removeNSFWTag,
    filterImages,
    hideImage,
    unhideImage,
    isImageHidden,
  };
}
