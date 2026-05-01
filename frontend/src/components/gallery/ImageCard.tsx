/**
 * 图片卡片组件
 * 展示单张图片的缩略图、来源标签和收藏按钮，支持懒加载缩略图
 */
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

/** 图片卡片：展示图片缩略图、来源标识、收藏心，memo 优化避免不必要的重渲染 */
export const ImageCard = memo(function ImageCard({ image, selected, onClick, onToggleFavorite }: ImageCardProps) {
  const [imgSrc, setImgSrc] = useState<string>('');
  const [loaded, setLoaded] = useState(false);
  const source = getSourceLabel(image.source_type); // 获取来源配置（颜色/标签）

  // 异步加载图片 base64 数据，组件卸载或依赖变化时取消请求
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
        if (!cancelled) {
          setImgSrc('');
          setLoaded(true);
        }
      });

    return () => { cancelled = true; };
  }, [image.id, image.stored_path, image.file_path, image.thumbnail_path]);

  return (
    <div
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
          className="absolute top-2 left-2 px-2 py-0.5 rounded-pill text-[9px] font-semibold text-white uppercase tracking-wider backdrop-blur-sm"
          style={{ backgroundColor: source.color + 'DD' }}
        >
          {source.label}
        </span>

        {/* 收藏按钮：hover 显示，已收藏时始终显示 */}
        <button
          onClick={(e) => {
            e.stopPropagation(); // 阻止冒泡触发卡片点击
            onToggleFavorite(image.id);
          }}
          className={cn(
            'absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center transition-all duration-200',
            'bg-white/90 backdrop-blur-sm hover:bg-white',
            'opacity-0 group-hover:opacity-100',
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
      </div>

      {/* 文件名信息 */}
      <div className="px-3 py-2.5 border-t border-ink-line">
        <p className="text-xs text-ink-secondary truncate" title={image.file_name}>
          {image.file_name}
        </p>
      </div>
    </div>
  );
});
