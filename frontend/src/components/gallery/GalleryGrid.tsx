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

// 根据卡片宽度推导列数和行高，避免详情面板开关后虚拟行距失真
const MIN_CARD_WIDTH = 170;
const MAX_COLUMN_COUNT = 4;
const GRID_GAP = 24;
const CARD_CAPTION_HEIGHT = 39;
const ROW_GAP = 32;

interface GalleryGridProps {
  images: ImageRecord[];
  loading: boolean;
  hasMore: boolean;
  selectedId: number | null;
  onSelect: (image: ImageRecord) => void;
  onToggleFavorite: (imageId: number) => void;
  onHideImage?: (imageId: number) => void;
  onLoadMore: () => void;
  onViewportCapacityChange?: (capacity: number) => void;
}

/** 画廊网格：基于虚拟滚动的图片列表，滚动到底部自动触发加载更多 */
export function GalleryGrid({
  images, loading, hasMore, selectedId, onSelect, onToggleFavorite, onHideImage, onLoadMore, onViewportCapacityChange,
}: GalleryGridProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();
  const [containerWidth, setContainerWidth] = useState(0);

  const columnCount = useMemo(() => {
    if (containerWidth <= 0) return MAX_COLUMN_COUNT;
    return Math.max(1, Math.min(MAX_COLUMN_COUNT, Math.floor((containerWidth + GRID_GAP) / (MIN_CARD_WIDTH + GRID_GAP))));
  }, [containerWidth]);

  const cardWidth = containerWidth > 0
    ? (containerWidth - GRID_GAP * (columnCount - 1)) / columnCount
    : MIN_CARD_WIDTH;
  const rowHeight = Math.ceil(cardWidth + CARD_CAPTION_HEIGHT);
  const rows = Math.ceil(images.length / columnCount); // 总行数

  // 虚拟滚动实例
  const virtualizer = useVirtualizer({
    count: hasMore ? rows + 1 : rows, // 有更多数据时多一行用于触发加载
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight + ROW_GAP,
    overscan: 3, // 预渲染上下各3行
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
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const updateWidth = () => setContainerWidth(el.clientWidth - 64);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    virtualizer.measure();
  }, [columnCount, rowHeight, virtualizer]);

  useEffect(() => {
    const el = parentRef.current;
    if (!el || !onViewportCapacityChange) return;
    const visibleRows = Math.ceil(el.clientHeight / Math.max(1, rowHeight + ROW_GAP));
    onViewportCapacityChange((visibleRows + 8) * columnCount);
  }, [columnCount, rowHeight, onViewportCapacityChange]);

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
      className="flex-1 overflow-auto px-8 pb-8 relative"
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
                  className="grid px-0"
                  style={{ gridTemplateColumns: `repeat(${columnCount}, 1fr)`, gap: GRID_GAP }}
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
                className="grid px-0"
                style={{ gridTemplateColumns: `repeat(${columnCount}, 1fr)`, gap: GRID_GAP }}
              >
                {rowImages.map(img => (
                  <ImageCard
                    key={img.id}
                    image={img}
                    selected={selectedId === img.id}
                    onClick={() => onSelect(img)}
                    onToggleFavorite={onToggleFavorite}
                    onHideImage={onHideImage}
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
