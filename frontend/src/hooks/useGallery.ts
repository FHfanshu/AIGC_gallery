// 图库核心 Hook — 管理图片列表的加载、搜索、分页、排序和删除逻辑

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { api } from '../lib/tauri';
import { parseMetadata } from '../lib/utils';
import type { ImageRecord } from '../types';

/** 排序字段类型 */
export type SortField = 'created_at' | 'file_name' | 'source_type' | 'dimensions' | 'aspect_ratio' | 'model' | 'prompt';
/** 排序方向 */
export type SortDirection = 'asc' | 'desc';

/**
 * useGallery — 图库页面的核心数据管理 hook
 * 提供图片列表的搜索、分页加载（无限滚动）、删除等功能
 */
export function useGallery() {
  const [images, setImages] = useState<ImageRecord[]>([]);       // 图片列表数据
  const [loading, setLoading] = useState(false);                 // 是否正在加载中
  const [error, setError] = useState<string | null>(null);       // 错误信息
  const [searchQuery, setSearchQuery] = useState('');            // 当前搜索关键词
  const [hasMore, setHasMore] = useState(true);                  // 是否还有更多数据可加载
  const [sortBy, setSortBy] = useState<SortField>('created_at'); // 当前排序字段
  const [sortDir, setSortDir] = useState<SortDirection>('desc'); // 排序方向
  const [limit, setLimit] = useState(50);                        // 每次从 DB 拉取的数据量

  const searchQueryRef = useRef(searchQuery);  // 搜索关键词的 ref 副本，避免闭包过期
  const offsetRef = useRef(0);                 // 当前分页偏移量

  // 保持 searchQueryRef 与最新 searchQuery 同步
  useEffect(() => { searchQueryRef.current = searchQuery; }, [searchQuery]);

  /**
   * 加载图片列表
   * @param reset - true 表示重置列表（搜索/刷新），false 表示追加加载（分页）
   */
  const loadImages = useCallback(async (reset = true) => {
    setLoading(true);
    setError(null);
    try {
      const pageLimit = limit;
      const off = reset ? 0 : offsetRef.current;  // 重置时从偏移量 0 开始
      const sq = searchQueryRef.current;           // 使用 ref 保证拿到最新搜索词
      const imgs = await api.getImages(off, pageLimit, sq);
      if (reset) {
        setImages(imgs);               // 重置：替换整个列表
        offsetRef.current = pageLimit;
      } else {
        setImages(prev => [...prev, ...imgs]);  // 追加：拼接到已有列表末尾
        offsetRef.current += pageLimit;
      }
      // 如果返回数量不足一页，说明没有更多数据了
      setHasMore(imgs.length === pageLimit);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [limit]);

  // 防抖处理搜索请求，避免输入时频繁调用接口
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const debouncedLoadImages = useCallback((reset = true) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);  // 清除上一次定时器
    debounceRef.current = setTimeout(() => loadImages(reset), 300); // 延迟 300ms 执行
  }, [loadImages]);

  /**
   * 加载更多图片 — 用于无限滚动触底时调用
   */
  const loadMore = useCallback(() => {
    if (!loading && hasMore) {
      loadImages(false);  // 以追加模式加载下一页
    }
  }, [loading, hasMore, loadImages]);

  /**
   * 删除单张图片 — 调用后端接口删除后从本地列表中移除
   */
  const deleteImage = useCallback(async (id: number) => {
    await api.deleteImage(id);
    setImages(prev => prev.filter(img => img.id !== id));  // 从列表中过滤掉已删除项
  }, []);

  const setLoadLimit = useCallback((nextLimit: number) => {
    setLimit(prev => {
      const normalized = Math.max(20, Math.min(120, nextLimit));
      return Math.abs(prev - normalized) >= 8 ? normalized : prev;
    });
  }, []);

  // 搜索关键词变化时自动触发防抖加载（重置列表）
  useEffect(() => {
    debouncedLoadImages(true);
  }, [searchQuery, debouncedLoadImages]);

  // 可视窗口容量变化时重新加载一屏附近的数据，避免固定 50 张在大/小窗口都不合适。
  useEffect(() => {
    debouncedLoadImages(true);
  }, [limit, debouncedLoadImages]);

  /** 根据当前排序字段和方向对已加载图片排序 */
  const sortedImages = useMemo(() => {
    const sorted = [...images];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case 'created_at':
          cmp = (a.created_at || '').localeCompare(b.created_at || '');
          break;
        case 'file_name':
          cmp = a.file_name.localeCompare(b.file_name, undefined, { numeric: true });
          break;
        case 'source_type':
          cmp = (a.source_type || '').localeCompare(b.source_type || '');
          break;
        case 'dimensions':
          cmp = (a.width * a.height) - (b.width * b.height);
          break;
        case 'aspect_ratio': {
          const ra = a.height > 0 ? a.width / a.height : 0;
          const rb = b.height > 0 ? b.width / b.height : 0;
          cmp = ra - rb;
          break;
        }
        case 'model': {
          const ma = parseMetadata(a.metadata_json)?.model || '';
          const mb = parseMetadata(b.metadata_json)?.model || '';
          cmp = ma.localeCompare(mb);
          break;
        }
        case 'prompt':
          cmp = (a.prompt || '').localeCompare(b.prompt || '');
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [images, sortBy, sortDir]);

  return {
    images: sortedImages, loading, error, searchQuery, setSearchQuery,
    hasMore, loadImages, loadMore, deleteImage, setImages,
    sortBy, setSortBy, sortDir, setSortDir, setLoadLimit,
  };
}
