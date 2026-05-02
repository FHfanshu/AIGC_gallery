/**
 * 图片画廊网格组件
 * 使用虚拟滚动渲染大量图片，支持分页加载和空状态展示
 */
import { useRef, useEffect, useMemo, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ImageCard } from './ImageCard';
import { Card } from '../ui';
import { useI18n } from '../../i18n';
import type { ImageRecord } from '../../types';

// 卡片最小宽度（决定列数），实际宽度根据容器自动撑满
const MIN_CARD_WIDTH = 140;
const MAX_COLUMNS = 8;
const GRID_GAP = 16;
const CARD_CAPTION_HEIGHT = 52;
const ROW_GAP = 16;

interface GalleryGridProps {
  images: ImageRecord[];
  loading: boolean;
  hasMore: boolean;
  selectedId: number | null;
  onSelect: (image: ImageRecord) => void;
  onToggleFavorite: (imageId: number) => void;
  onHideImage?: (imageId: number) => void;
  isImageHidden?: (imageId: number) => boolean;
  onUnhideImage?: (imageId: number) => void;
  onLoadMore: () => void;
  onViewportCapacityChange?: (capacity: number) => void;
  scrollToImageId?: number | null;
}

/** 画廊网格：基于虚拟滚动的图片列表，滚动到底部自动触发加载更多 */
export function GalleryGrid({
  images, loading, hasMore, selectedId, onSelect, onToggleFavorite, onHideImage, isImageHidden, onUnhideImage, onLoadMore, onViewportCapacityChange, scrollToImageId,
}: GalleryGridProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();
  const [containerWidth, setContainerWidth] = useState(0);
  const lastScrollTopRef = useRef(0);
  const scrollEndTimerRef = useRef<number | null>(null);
  const scrollRafRef = useRef<number | null>(null);

  // 根据容器宽度计算列数，卡片宽度自适应撑满
  const { columnCount, cardWidth } = useMemo(() => {
    if (containerWidth <= 0) return { columnCount: 1, cardWidth: MIN_CARD_WIDTH };
    const cols = Math.max(1, Math.min(MAX_COLUMNS,
      Math.floor((containerWidth + GRID_GAP) / (MIN_CARD_WIDTH + GRID_GAP))));
    const cw = (containerWidth - (cols - 1) * GRID_GAP) / cols;
    return { columnCount: cols, cardWidth: Math.max(MIN_CARD_WIDTH, cw) };
  }, [containerWidth]);

  const rowHeight = cardWidth + CARD_CAPTION_HEIGHT;
  const rows = Math.ceil(images.length / columnCount); // 总行数

  // 虚拟滚动实例
  const virtualizer = useVirtualizer({
    count: hasMore ? rows + 1 : rows, // 有更多数据时多一行用于触发加载
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight + ROW_GAP,
    overscan: 6, // 提前预渲染更多行，让缩略图有时间在进入视口前完成加载
  });

  // 滚动触底检测：倒数第二行出现时触发加载更多
  useEffect(() => {
    const virtualItems = virtualizer.getVirtualItems();
    if (virtualItems.length === 0) return;
    const lastItem = virtualItems[virtualItems.length - 1];
    if (lastItem.index >= rows - 2 && hasMore && !loading) {
      onLoadMore();
    }
  }, [virtualizer.getVirtualItems(), rows, hasMore, loading, onLoadMore]);

  // 详情面板开关或窗口缩放会改变网格宽度，虚拟滚动必须同步重算行高
  // ResizeObserver 监听容器宽度变化，防抖跨过面板动画避免列数跳变
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    let timer: number | undefined;
    const measureWidth = () => setContainerWidth(Math.max(0, el.clientWidth - 64));
    const updateWidth = () => {
      if (timer) window.clearTimeout(timer);
      // 280ms 防抖让面板动画期间网格保持当前列数，动画结束后一次到位
      timer = window.setTimeout(measureWidth, 280);
    };
    measureWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(el);
    return () => { observer.disconnect(); if (timer) window.clearTimeout(timer); };
  }, []);

  // 等待 DOM 布局完成后同步虚拟滚动尺寸，避免最大化后行高与实际内容不匹配
  useEffect(() => {
    const raf = requestAnimationFrame(() => virtualizer.measure());
    return () => cancelAnimationFrame(raf);
  }, [columnCount, cardWidth, rowHeight, virtualizer]);

  useEffect(() => {
    const el = parentRef.current;
    if (!el || !onViewportCapacityChange) return;
    const visibleRows = Math.ceil(el.clientHeight / Math.max(1, rowHeight + ROW_GAP));
    onViewportCapacityChange((visibleRows + 14) * columnCount);
  }, [columnCount, rowHeight, onViewportCapacityChange]);

  useEffect(() => {
    if (!scrollToImageId) return;
    const imageIndex = images.findIndex(img => img.id === scrollToImageId);
    if (imageIndex < 0) return;
    virtualizer.scrollToIndex(Math.floor(imageIndex / columnCount), { align: 'center' });
  }, [columnCount, images, scrollToImageId, virtualizer]);

  const handleScroll = () => {
    const el = parentRef.current;
    if (!el || scrollRafRef.current) return;

    scrollRafRef.current = window.requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const nextTop = el.scrollTop;
      const direction = nextTop >= lastScrollTopRef.current ? 'down' : 'up';
      lastScrollTopRef.current = nextTop;

      el.classList.add('motion-gallery-scrolling');
      el.classList.toggle('motion-gallery-scroll-down', direction === 'down');
      el.classList.toggle('motion-gallery-scroll-up', direction === 'up');

      if (scrollEndTimerRef.current) {
        window.clearTimeout(scrollEndTimerRef.current);
      }
      scrollEndTimerRef.current = window.setTimeout(() => {
        el.classList.remove('motion-gallery-scrolling', 'motion-gallery-scroll-down', 'motion-gallery-scroll-up');
      }, 120);
    });
  };

  useEffect(() => {
    return () => {
      if (scrollEndTimerRef.current) {
        window.clearTimeout(scrollEndTimerRef.current);
      }
      if (scrollRafRef.current) {
        window.cancelAnimationFrame(scrollRafRef.current);
      }
    };
  }, []);

  if (images.length === 0 && !loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <Card className="max-w-md text-center" padding="lg" bordered>
          <div className="flex justify-center mb-5">
            <div className="w-16 h-16 rounded-full bg-ink-surface border border-ink-line flex items-center justify-center">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" className="text-ink-muted" strokeWidth="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" />
                <circle cx="8.5" cy="8.5" r="1.5" stroke="currentColor" />
                <path d="m21 15-5-5L5 21" stroke="currentColor" />
              </svg>
            </div>
          </div>
          <h2 className="font-display font-bold text-lg text-ink mb-2">{t.gallery.emptyTitle}</h2>
          <p className="text-sm text-ink-muted mb-4">
            {t.gallery.emptyHint}
          </p>
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-btn bg-ink-surface border border-ink-line text-xs text-ink-muted">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span>{t.import.dropHere}</span>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      className="flex-1 overflow-y-auto overflow-x-hidden px-8 pt-4 pb-8 relative motion-gallery-scroll gallery-contain"
      onScroll={handleScroll}
    >
      <div
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map(virtualRow => {
          const rowIndex = virtualRow.index;
          // 超出实际行数的为加载占位行
          if (rowIndex >= rows) {
            return (
              <div
                key={virtualRow.key}
                className="absolute top-0 left-0 w-full"
                style={{
                  transform: `translateY(${virtualRow.start}px)`,
                  height: virtualRow.size - ROW_GAP,
                }}
              >
                <div
                  className="grid px-0 motion-gallery-row"
                  style={{ gridTemplateColumns: `repeat(${columnCount}, ${cardWidth}px)`, gap: GRID_GAP, justifyContent: 'center' }}
                >
                  {Array.from({ length: columnCount }).map((_, i) => (
                    <div
                      key={i}
                      className="rounded-card bg-ink-surface border border-ink-line animate-pulse aspect-[3/4]"
                    />
                  ))}
                </div>
              </div>
            );
          }

          // 按行切片图片数据
          const startIdx = rowIndex * columnCount;
          const rowImages = images.slice(startIdx, startIdx + columnCount);

          return (
            <div
              key={virtualRow.key}
              className="absolute top-0 left-0 w-full"
              style={{
                transform: `translateY(${virtualRow.start}px)`,
                height: virtualRow.size - ROW_GAP,
              }}
            >
              <div
                className="grid px-0 motion-gallery-row"
                style={{ gridTemplateColumns: `repeat(${columnCount}, ${cardWidth}px)`, gap: GRID_GAP, justifyContent: 'center' }}
              >
                {rowImages.map(img => (
                  <ImageCard
                    key={img.id}
                    image={img}
                    selected={selectedId === img.id}
                    onClick={() => onSelect(img)}
                    onToggleFavorite={onToggleFavorite}
                    onHideImage={onHideImage}
                    isImageHidden={isImageHidden}
                    onUnhideImage={onUnhideImage}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* 底部加载指示器 */}
      {loading && images.length > 0 && (
        <div className="flex justify-center py-4">
          <div className="w-6 h-6 rounded-full border-2 border-ink-line border-t-ink animate-spin" />
        </div>
      )}
    </div>
  );
}
