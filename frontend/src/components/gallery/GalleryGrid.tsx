/**
 * 图片画廊网格组件
 * 使用虚拟滚动渲染大量图片，支持分页加载和空状态展示
 */
import { useRef, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ImageCard } from './ImageCard';
import { Card } from '../ui';
import { useI18n } from '../../i18n';
import type { ImageRecord } from '../../types';

// 卡片目标宽度（决定列数），不同密度保持明确可感知的尺寸差异
const GRID_GAP = 16;
const GRID_HORIZONTAL_PADDING = 64;
const CARD_CAPTION_HEIGHT = 52;
const ROW_GAP = 16;
const SIDEBAR_WIDTH = 280;

export type GalleryDensity = 'small' | 'medium' | 'large';

const DENSITY_CARD_WIDTH: Record<GalleryDensity, number> = {
  small: 108,
  medium: 156,
  large: 220,
};

interface ScrollAnchor {
  imageIndex: number;
  rowOffset: number;
  rowSize: number;
}

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
  density: GalleryDensity;
}

/** 画廊网格：基于虚拟滚动的图片列表，滚动到底部自动触发加载更多 */
export function GalleryGrid({
  images, loading, hasMore, selectedId, onSelect, onToggleFavorite, onHideImage, isImageHidden, onUnhideImage, onLoadMore, onViewportCapacityChange, scrollToImageId, density,
}: GalleryGridProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();
  const [containerWidth, setContainerWidth] = useState(() => {
    if (typeof window === 'undefined') return 0;
    return Math.max(0, window.innerWidth - SIDEBAR_WIDTH - GRID_HORIZONTAL_PADDING);
  });
  const lastScrollTopRef = useRef(0);
  const scrollEndTimerRef = useRef<number | null>(null);
  const scrollRafRef = useRef<number | null>(null);
  const pendingAnchorRef = useRef<ScrollAnchor | null>(null);
  const containerWidthRef = useRef(containerWidth);
  const layoutRef = useRef({ columnCount: 1, rowSize: 1 });

  // 根据目标卡片宽度计算列数，避免小/中密度被整行拉伸后看起来没变化。
  const { columnCount, cardWidth } = useMemo(() => {
    const targetCardWidth = DENSITY_CARD_WIDTH[density];
    if (containerWidth <= 0) return { columnCount: 1, cardWidth: targetCardWidth };
    const cols = Math.max(1, Math.floor((containerWidth + GRID_GAP) / (targetCardWidth + GRID_GAP)));
    return { columnCount: cols, cardWidth: Math.min(targetCardWidth, containerWidth) };
  }, [containerWidth, density]);

  const rowHeight = cardWidth + CARD_CAPTION_HEIGHT;
  const rowSize = rowHeight + ROW_GAP;
  const rows = Math.ceil(images.length / columnCount); // 总行数

  useLayoutEffect(() => {
    containerWidthRef.current = containerWidth;
    layoutRef.current = { columnCount, rowSize };
  }, [columnCount, containerWidth, rowSize]);

  // 虚拟滚动实例
  const virtualizer = useVirtualizer({
    count: hasMore ? rows + 1 : rows, // 有更多数据时多一行用于触发加载
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowSize,
    overscan: 6, // 提前预渲染更多行，让缩略图有时间在进入视口前完成加载
  });

  /** 容器宽度变化前记录顶部图片，而不是记录行号；列数变化后同一行号会指向不同图片。 */
  const captureScrollAnchor = () => {
    const el = parentRef.current;
    if (!el || images.length === 0) return;
    const layout = layoutRef.current;
    const currentRow = Math.max(0, Math.floor(el.scrollTop / Math.max(1, layout.rowSize)));
    const imageIndex = Math.min(images.length - 1, currentRow * layout.columnCount);
    pendingAnchorRef.current = {
      imageIndex,
      rowOffset: Math.max(0, el.scrollTop - currentRow * layout.rowSize),
      rowSize: layout.rowSize,
    };
  };

  // 滚动触底检测：倒数第二行出现时触发加载更多
  useEffect(() => {
    const virtualItems = virtualizer.getVirtualItems();
    if (virtualItems.length === 0) return;
    const lastItem = virtualItems[virtualItems.length - 1];
    if (lastItem.index >= rows - 2 && hasMore && !loading) {
      onLoadMore();
    }
  }, [virtualizer.getVirtualItems(), rows, hasMore, loading, onLoadMore]);

  // 详情面板开关或窗口缩放会改变网格宽度，虚拟滚动必须同步重算行高。
  // useLayoutEffect 中同步测量宽度，确保在浏览器绘制前拿到正确尺寸，
  // 避免详情面板打开时虚拟滚动使用过期的容器宽度导致图片被"吞掉"。
  useLayoutEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    let timer: number | undefined;
    let raf: number | undefined;
    const measureWidth = () => {
      const nextWidth = Math.max(0, el.clientWidth - GRID_HORIZONTAL_PADDING);
      if (Math.abs(containerWidthRef.current - nextWidth) > 1) {
        captureScrollAnchor();
        containerWidthRef.current = nextWidth;
        setContainerWidth(nextWidth);
      }
      return nextWidth;
    };
    // 同步测量：useLayoutEffect 在 DOM 突变后、绘制前执行，
    // 此时 el.clientWidth 已反映详情面板打开/关闭后的真实宽度。
    measureWidth();
    const updateWidth = () => {
      if (raf) window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(() => {
        const nextWidth = measureWidth();
        if (timer) window.clearTimeout(timer);
        // 启动早期 WebView 可能先给出 0 宽度，下一帧再补测一次避免首屏卡成单列。
        timer = window.setTimeout(measureWidth, nextWidth > 0 ? 120 : 16);
      });
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(el);
    window.addEventListener('resize', updateWidth);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateWidth);
      if (raf) window.cancelAnimationFrame(raf);
      if (timer) window.clearTimeout(timer);
    };
  }, [density, images.length, selectedId]);

  // 列数变化后：用之前记录的顶部图片索引计算新行号，避免 4 列变 2 列时同一像素偏移映射到错误图片。
  useLayoutEffect(() => {
    virtualizer.measure();
    const anchor = pendingAnchorRef.current;
    if (!anchor || images.length === 0) return;

    pendingAnchorRef.current = null;
    const clampedImageIndex = Math.min(anchor.imageIndex, images.length - 1);
    const nextRow = Math.floor(clampedImageIndex / columnCount);
    const offsetRatio = anchor.rowOffset / Math.max(1, anchor.rowSize);
    const nextOffset = nextRow * rowSize + Math.min(rowSize - 1, offsetRatio * rowSize);
    virtualizer.scrollToOffset(nextOffset, { behavior: 'auto' });
  }, [columnCount, images.length, rowSize, virtualizer]);

  useEffect(() => {
    const el = parentRef.current;
    if (!el || !onViewportCapacityChange) return;
    const visibleRows = Math.ceil(el.clientHeight / Math.max(1, rowSize));
    onViewportCapacityChange((visibleRows + 14) * columnCount);
  }, [columnCount, rowSize, onViewportCapacityChange]);

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

      el.classList.toggle('motion-gallery-scroll-down', direction === 'down');
      el.classList.toggle('motion-gallery-scroll-up', direction === 'up');

      if (scrollEndTimerRef.current) {
        window.clearTimeout(scrollEndTimerRef.current);
      }
      scrollEndTimerRef.current = window.setTimeout(() => {
        el.classList.remove('motion-gallery-scroll-down', 'motion-gallery-scroll-up');
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
      className="flex-1 overflow-y-auto overflow-x-hidden pt-4 pb-8 relative motion-gallery-scroll gallery-contain"
      onScroll={handleScroll}
    >
      <div
        className="relative w-full px-8"
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
                className="grid px-0"
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
