import { useRef, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ImageCard } from './ImageCard';
import { NeuCard } from '../ui';
import { useI18n } from '../../i18n';
import type { ImageRecord } from '../../types';

const COLUMN_COUNT = 4;
const ROW_HEIGHT = 280;
const GAP = 16;

interface GalleryGridProps {
  images: ImageRecord[];
  loading: boolean;
  hasMore: boolean;
  selectedId: number | null;
  onSelect: (image: ImageRecord) => void;
  onToggleFavorite: (imageId: number) => void;
  onLoadMore: () => void;
}

export function GalleryGrid({
  images,
  loading,
  hasMore,
  selectedId,
  onSelect,
  onToggleFavorite,
  onLoadMore,
}: GalleryGridProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();

  const rows = Math.ceil(images.length / COLUMN_COUNT);

  const virtualizer = useVirtualizer({
    count: hasMore ? rows + 1 : rows,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT + GAP,
    overscan: 3,
  });

  // Trigger load more when virtualizer reaches near the end
  useEffect(() => {
    const virtualItems = virtualizer.getVirtualItems();
    if (virtualItems.length === 0) return;
    const lastItem = virtualItems[virtualItems.length - 1];
    if (lastItem.index >= rows - 2 && hasMore && !loading) {
      onLoadMore();
    }
  }, [virtualizer.getVirtualItems(), rows, hasMore, loading, onLoadMore]);

  // Empty state
  if (images.length === 0 && !loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <NeuCard className="max-w-md text-center" padding="lg">
          <div className="flex justify-center mb-4">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" className="text-neu-muted opacity-40" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" />
              <circle cx="8.5" cy="8.5" r="1.5" stroke="currentColor" />
              <path d="m21 15-5-5L5 21" stroke="currentColor" />
            </svg>
          </div>
          <h2 className="font-display font-bold text-xl text-neu-text mb-2">{t.gallery.emptyTitle}</h2>
          <p className="text-sm text-neu-muted">
            {t.gallery.emptyHint}
          </p>
        </NeuCard>
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      className="flex-1 overflow-auto px-6 pb-6 relative"
    >
      <div
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map(virtualRow => {
          const rowIndex = virtualRow.index;
          if (rowIndex >= rows) {
            // Loading placeholder row
            return (
              <div
                key={virtualRow.key}
                className="absolute top-0 left-0 w-full"
                style={{
                  transform: `translateY(${virtualRow.start}px)`,
                  height: virtualRow.size,
                }}
              >
                <div className="grid grid-cols-4 gap-4 px-0">
                  {Array.from({ length: COLUMN_COUNT }).map((_, i) => (
                    <div
                      key={i}
                      className="rounded-neu-card bg-neu-bg neu-raised animate-pulse aspect-[3/4]"
                    />
                  ))}
                </div>
              </div>
            );
          }

          const startIdx = rowIndex * COLUMN_COUNT;
          const rowImages = images.slice(startIdx, startIdx + COLUMN_COUNT);

          return (
            <div
              key={virtualRow.key}
              className="absolute top-0 left-0 w-full"
              style={{
                transform: `translateY(${virtualRow.start}px)`,
                height: virtualRow.size,
              }}
            >
              <div
                className="grid gap-4 px-0"
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

      {/* Loading indicator */}
      {loading && images.length > 0 && (
        <div className="flex justify-center py-4">
          <div className="w-8 h-8 rounded-full border-2 border-neu-accent/30 border-t-neu-accent animate-spin" />
        </div>
      )}
    </div>
  );
}
