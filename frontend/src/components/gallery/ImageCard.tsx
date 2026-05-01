import { memo, useState, useEffect } from 'react';
import { cn, truncate, getSourceLabel } from '../../lib/utils';
import { api } from '../../lib/tauri';
import type { ImageRecord } from '../../types';

interface ImageCardProps {
  image: ImageRecord;
  selected: boolean;
  onClick: () => void;
  onToggleFavorite: (imageId: number) => void;
}

export const ImageCard = memo(function ImageCard({ image, selected, onClick, onToggleFavorite }: ImageCardProps) {
  const [imgSrc, setImgSrc] = useState<string>('');
  const [loaded, setLoaded] = useState(false);
  const source = getSourceLabel(image.source_type);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);

    api.getImageBase64(image.id, true)
      .then(src => {
        if (!cancelled) {
          setImgSrc(src);
          setLoaded(true);
        }
      })
      .catch(() => {
        // Fallback: try convertFileSrc on stored_path or file_path
        if (!cancelled) {
          const fallback = image.stored_path || image.file_path;
          setImgSrc(fallback ? `https://asset.localhost/${fallback.replace(/\\/g, '/')}` : '');
          setLoaded(true);
        }
      });

    return () => { cancelled = true; };
  }, [image.id, image.stored_path, image.file_path, image.thumbnail_path]);

  return (
    <div
      className={cn(
        'rounded-neu-card bg-neu-bg transition-all duration-300 ease-out cursor-pointer overflow-hidden group',
        selected
          ? 'neu-inset ring-2 ring-neu-accent'
          : 'neu-raised hover:-translate-y-[2px] hover:neu-raised-hover'
      )}
      onClick={onClick}
    >
      {/* Image */}
      <div className="relative aspect-square overflow-hidden rounded-t-neu-card">
        {!loaded ? (
          <div className="w-full h-full bg-neu-bg neu-inset animate-pulse" />
        ) : imgSrc ? (
          <img
            src={imgSrc}
            alt={image.file_name}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            onError={e => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : null}

        {/* Source badge */}
        <span
          className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-semibold text-white backdrop-blur-sm"
          style={{ backgroundColor: source.color + 'CC' }}
        >
          {source.label}
        </span>

        {/* Favorite heart */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(image.id);
          }}
          className={cn(
            'absolute top-2 right-2 w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300',
            'bg-white/80 backdrop-blur-sm hover:bg-white',
            'opacity-0 group-hover:opacity-100',
            image.is_favorite && '!opacity-100'
          )}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill={image.is_favorite ? '#E53E3E' : 'none'}
            stroke={image.is_favorite ? '#E53E3E' : '#6B7280'}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
        </button>
      </div>

      {/* Info */}
      <div className="p-3">
        <p className="text-xs text-neu-muted truncate" title={image.file_name}>
          {image.file_name}
        </p>
        {image.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {image.tags.slice(0, 3).map(t => (
              <span
                key={t}
                className="inline-block px-2 py-0.5 rounded-full text-[10px] font-medium bg-neu-bg neu-inset-sm text-neu-muted"
              >
                {t}
              </span>
            ))}
            {image.tags.length > 3 && (
              <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-medium bg-neu-bg neu-inset-sm text-neu-muted">
                +{image.tags.length - 3}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
