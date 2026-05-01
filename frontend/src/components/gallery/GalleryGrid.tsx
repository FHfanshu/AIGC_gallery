/**
 * 图片画廊网格组件
 * 使用虚拟滚动渲染大量图片，支持分页加载和空状态展示
 */
import { useRef, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ImageCard } from './ImageCard';
import { Card } from '../ui';
import { useI18n } from '../../i18n';
import type { ImageRecord } from '../../types';

// 每行列数、行高、行间距
const COLUMN_COUNT = 4;
const ROW_HEIGHT = 300;
const ROW_GAP = 32;

interface GalleryGridProps {
  images: ImageRecord[];
  loading: boolean;
  hasMore: boolean;
  selectedId: number | null;
  onSelect: (image: ImageRecord) => void;
  onToggleFavorite: (imageId: number) => void;
  onLoadMore: () => void;
}

/** 画廊网格：基于虚拟滚动的图片列表，滚动到底部自动触发加载更多 */
export function GalleryGrid({
  images, loading, hasMore, selectedId, onSelect, onToggleFavorite, onLoadMore,
}: GalleryGridProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();

  const rows = Math.ceil(images.length / COLUMN_COUNT); // 总行数

  // 虚拟滚动实例
  const virtualizer = useVirtualizer({
    count: hasMore ? rows + 1 : rows, // 有更多数据时多一行用于触发加载
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT + ROW_GAP,
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

  // 空状态：无图片且非加载中
  if (images.length === 0 && !loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <Card className="max-w-md text-center" padding="lg" bordered>
          <div className="flex justify-center mb-4">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" className="text-ink-faint" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" />
              <circle cx="8.5" cy="8.5" r="1.5" stroke="currentColor" />
              <path d="m21 15-5-5L5 21" stroke="currentColor" />
            </svg>
          </div>
          <h2 className="font-display font-bold text-lg text-ink mb-2">{t.gallery.emptyTitle}</h2>
          <p className="text-sm text-ink-muted">
            {t.gallery.emptyHint}
          </p>
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
                <div className="grid grid-cols-4 gap-6 px-0">
                  {Array.from({ length: COLUMN_COUNT }).map((_, i) => (
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
          const startIdx = rowIndex * COLUMN_COUNT;
          const rowImages = images.slice(startIdx, startIdx + COLUMN_COUNT);

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
                className="grid gap-6 px-0"
                style={{ gridTemplateColumns: `repeat(${COLUMN_COUNT}, 1fr)` }}
              >
                {rowImages.map(img => (
                  <ImageCard
                    key={img.id}
                    image={img}
                    selected={selectedId === img.id}
                    onClick={() => onSelect(img)}
                    onToggleFavorite={onToggleFavorite}
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
