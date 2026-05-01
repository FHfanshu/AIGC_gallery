// 标签管理 Hook — 提供标签的加载、新增、删除操作

import { useState, useCallback, useEffect } from 'react';
import { api } from '../lib/tauri';
import type { TagRecord } from '../types';

/**
 * useTags — 标签数据管理 hook
 * 提供标签列表的加载、新增标签、删除标签等功能
 * 标签用于对图片进行分类标记
 */
export function useTags() {
  const [tags, setTags] = useState<TagRecord[]>([]);  // 标签列表数据

  /** 从后端加载全部标签 */
  const loadTags = useCallback(async () => {
    try {
      setTags(await api.getAllTags());
    } catch (e) {
      console.error('Failed to load tags:', e);
    }
  }, []);

  /**
   * 新增标签
   * @param name - 标签名称
   * @param color - 标签颜色（可选，十六进制色值）
   */
  const addTag = useCallback(async (name: string, color?: string) => {
    await api.addTag(name, color);
    await loadTags();  // 新增后重新加载列表以保持同步
  }, [loadTags]);

  /**
   * 删除标签
   * @param tagId - 要删除的标签 ID
   */
  const removeTag = useCallback(async (tagId: number) => {
    await api.removeTag(tagId);
    await loadTags();  // 删除后重新加载列表以保持同步
  }, [loadTags]);

  // 组件挂载时自动加载标签列表
  useEffect(() => { loadTags(); }, [loadTags]);

  return { tags, loadTags, addTag, removeTag };
}
