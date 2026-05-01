/**
 * 图片卡片组件
 * 展示单张图片的缩略图、来源标签和收藏按钮，支持懒加载缩略图
 */
import { memo, useState, useEffect, useRef } from 'react';
import { cn, truncate, getSourceLabel } from '../../lib/utils';
import { api } from '../../lib/tauri';
import type { ImageRecord } from '../../types';

interface ImageCardProps {
  image: ImageRecord;
  selected: boolean;
  onClick: () => void;
  onToggleFavorite: (imageId: number) => void;
  onHideImage?: (imageId: number) => void;  // 手动标记为 NSFW
}

/** 图片卡片：展示图片缩略图、来源标识、收藏心，memo 优化避免不必要的重渲染 */
export const ImageCard = memo(function ImageCard({ image, selected, onClick, onToggleFavorite, onHideImage }: ImageCardProps) {
  const [imgSrc, setImgSrc] = useState<string>('');
  const [loaded, setLoaded] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const source = getSourceLabel(image.source_type); // 获取来源配置（颜色/标签）

  // 只有卡片进入可视窗口附近时才加载缩略图，避免 overscan 外或未显示卡片触发 IPC。
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    let cancelled = false;
    let started = false;
    setImgSrc('');
    setLoaded(false);

    const loadImage = () => {
      if (started || cancelled) return;
      started = true;
      api.getImageBase64(image.id, true)
        .then(src => {
          if (!cancelled) {
            setImgSrc(src);
            setLoaded(true);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setImgSrc('');
            setLoaded(true);
          }
        });
    };

    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        loadImage();
        observer.disconnect();
      }
    }, { root: null, rootMargin: '900px 0px', threshold: 0.01 });
    observer.observe(el);

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [image.id, image.stored_path, image.file_path, image.thumbnail_path]);

  return (
    <div
      ref={cardRef}
      className={cn(
        'rounded-card bg-ink-bg transition-all duration-150 cursor-pointer overflow-hidden group border',
        selected
          ? 'border-ink ring-1 ring-ink'
          : 'border-ink-line hover:border-ink-muted'
      )}
      onClick={onClick}
    >
      {/* 图片区域 */}
      <div className="relative aspect-square overflow-hidden bg-ink-surface">
        {!loaded ? (
          // 加载中骨架屏
          <div className="w-full h-full bg-ink-surface animate-pulse" />
        ) : imgSrc ? (
          <img
            src={imgSrc}
            alt={image.file_name}
            className="w-full h-full object-cover object-top transition-transform duration-500 group-hover:scale-[1.02]"
            onError={e => {
              (e.target as HTMLImageElement).style.display = 'none'; // 加载失败时隐藏
            }}
          />
        ) : null}

        {/* 来源标签（如 SD、MJ 等） */}
        <span
          className="absolute top-2 left-2 px-2 py-0.5 rounded-pill text-[10px] font-semibold text-white uppercase tracking-wider backdrop-blur-sm"
          style={{ backgroundColor: source.color + 'DD' }}
        >
          {source.label}
        </span>

        {/* 右上角操作按钮：收藏 + 隐藏 */}
        <div className="absolute top-2 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          {/* 收藏按钮 */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite(image.id);
            }}
            className={cn(
              'w-7 h-7 rounded-full flex items-center justify-center transition-all duration-200',
              'bg-white/90 backdrop-blur-sm hover:bg-white',
              image.is_favorite && '!opacity-100'
            )}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill={image.is_favorite ? '#DC2626' : 'none'}
              stroke={image.is_favorite ? '#DC2626' : '#8A8A8A'}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </button>
          {/* 隐藏（NSFW）按钮 */}
          {onHideImage && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onHideImage(image.id);
              }}
              title="标记为 NSFW 并隐藏"
              className="w-7 h-7 rounded-full flex items-center justify-center bg-white/90 backdrop-blur-sm hover:bg-red-50 transition-all duration-200"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8A8A8A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* 文件名和提示词预览 */}
      <div className="px-3 py-2 border-t border-ink-line space-y-0.5">
        <p className="text-[11px] text-ink-secondary truncate" title={image.file_name}>
          {image.file_name}
        </p>
        {image.prompt && (
          <p className="text-[10px] text-ink-muted truncate" title={image.prompt}>
            {truncate(image.prompt, 60)}
          </p>
        )}
      </div>
    </div>
  );
});
