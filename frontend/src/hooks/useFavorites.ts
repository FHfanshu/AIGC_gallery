// 收藏管理 Hook — 提供收藏列表的加载和收藏/取消收藏切换功能

import { useState, useCallback } from 'react';
import { api } from '../lib/tauri';
import type { ImageRecord } from '../types';

/**
 * useFavorites — 收藏功能管理 hook
 * 提供已收藏图片列表的加载，以及单张图片的收藏状态切换
 */
export function useFavorites() {
  const [favorites, setFavorites] = useState<ImageRecord[]>([]);  // 已收藏图片列表
  const [loading, setLoading] = useState(false);                   // 是否正在加载

  /** 从后端加载全部已收藏图片 */
  const loadFavorites = useCallback(async () => {
    setLoading(true);
    try {
      setFavorites(await api.getFavorites());
    } catch (e) {
      console.error('Failed to load favorites:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * 切换图片的收藏状态
   * @param imageId - 目标图片 ID
   * @returns 切换后的新收藏状态（true=已收藏，false=已取消）
   */
  const toggleFavorite = useCallback(async (imageId: number): Promise<boolean> => {
    const newState = await api.toggleFavorite(imageId);
    return newState;
  }, []);

  const refresh = loadFavorites;

  return { favorites, loading, loadFavorites, refresh, toggleFavorite, setFavorites };
}
