// 图库统计 Hook — 加载并提供图库的统计数据（图片总数、标签总数、模型分布等）

import { useState, useCallback, useEffect } from 'react';
import { api } from '../lib/tauri';
import type { ImageStats } from '../types';

/**
 * useStats — 图库统计数据管理 hook
 * 用于仪表盘页面展示图库概览信息，包括图片总数、标签数量和模型使用分布
 */
export function useStats() {
  const [stats, setStats] = useState<ImageStats | null>(null);  // 统计数据，初始为 null 表示未加载

  /** 从后端获取最新统计数据 */
  const loadStats = useCallback(async () => {
    try {
      setStats(await api.getStats());
    } catch (e) {
      console.error('Failed to load stats:', e);
    }
  }, []);

  // 组件挂载时自动加载统计数据
  useEffect(() => { loadStats(); }, [loadStats]);

  const refresh = loadStats;

  return { stats, loadStats, refresh };
}
