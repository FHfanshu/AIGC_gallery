/**
 * 图片卡片组件
 * 展示单张图片的缩略图、来源标签和收藏按钮，支持懒加载缩略图
 */
import { memo, useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cn, getSourceLabel } from '../../lib/utils';
import { api } from '../../lib/tauri';
import { useI18n } from '../../i18n';
import type { ImageRecord } from '../../types';

interface ImageCardProps {
  image: ImageRecord;
  selected: boolean;
  onClick: () => void;
  onToggleFavorite: (imageId: number) => void;
  onHideImage?: (imageId: number) => void;  // 手动标记为 NSFW
  isImageHidden?: (imageId: number) => boolean;  // 判断图片是否被手动隐藏
  onUnhideImage?: (imageId: number) => void;  // 取消手动隐藏
}

/** 图片卡片：展示图片缩略图、来源标识、收藏心，memo 优化避免不必要的重渲染 */
export const ImageCard = memo(function ImageCard({ image, selected, onClick, onToggleFavorite, onHideImage, isImageHidden, onUnhideImage }: ImageCardProps) {
  const [imgSrc, setImgSrc] = useState<string>('');
  const [loaded, setLoaded] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const { t } = useI18n();
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
      const src = api.getThumbnailSrc(image);
      if (src) {
        setImgSrc(src);
        return;
      }
      api.getImageBase64(image.id, true)
        .then(src => {
          if (!cancelled) setImgSrc(src);
        })
        .catch(() => {
          if (!cancelled) setLoaded(true);
        });
    };

    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        loadImage();
        observer.disconnect();
      }
    }, { root: null, rootMargin: '360px 0px', threshold: 0.01 });
    observer.observe(el);

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [image.id, image.stored_path, image.file_path, image.thumbnail_path]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu]);

  const runContextAction = (action: () => void | Promise<void>) => {
    setContextMenu(null);
    void Promise.resolve(action()).catch(error => {
      console.error('Image context action failed:', error);
    });
  };

  const menuX = contextMenu ? Math.min(contextMenu.x, Math.max(8, window.innerWidth - 224)) : 0;
  const menuY = contextMenu ? Math.min(contextMenu.y, Math.max(8, window.innerHeight - 180)) : 0;

  return (
    <div
      ref={cardRef}
      className={cn(
        'rounded-card bg-ink-bg transition-colors duration-150 cursor-pointer overflow-hidden group border',
        selected
          ? 'border-ink ring-1 ring-ink'
          : 'border-ink-line hover:border-ink-muted'
      )}
      onClick={onClick}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setContextMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      {/* 图片区域 */}
      <div className="relative aspect-square overflow-hidden bg-ink-surface">
        {imgSrc ? (
          <img
            src={imgSrc}
            alt={image.file_name}
            className={cn(
              'w-full h-full object-cover object-top transition-opacity duration-200',
              loaded ? 'opacity-100 motion-media-in' : 'opacity-0'
            )}
            onLoad={() => setLoaded(true)}
            onError={() => {
              setLoaded(false);
              const fallback = api.getStoredImageSrc(image);
              if (fallback && fallback !== imgSrc) {
                setImgSrc(fallback);
              } else {
                api.getImageBase64(image.id, true)
                  .then(src => setImgSrc(src))
                  .catch(() => {
                    setImgSrc('');
                    setLoaded(true);
                  });
              }
            }}
          />
        ) : null}

        {/* 缩略图真正完成加载前显示加载动画，避免 asset/base64 等待期间出现空白。 */}
        {!loaded && (
          <div
            className="absolute inset-0 bg-ink-surface motion-thumb-loading"
            style={{ ['--source-color' as string]: source.color }}
          >
            <div className="absolute inset-0 motion-thumb-blocks" />
            <div className="absolute inset-0 motion-thumb-grain" />
            <div className="absolute inset-x-0 bottom-0 h-1/3 motion-thumb-veil" />
            <div className="absolute inset-0 motion-shimmer" />
            <div className="absolute left-2 bottom-2 right-2 flex items-center gap-2">
              <div className="motion-thumb-orbit" />
              <div className="h-px flex-1 bg-ink/10 overflow-hidden">
                <div className="motion-thumb-line" />
              </div>
            </div>
          </div>
        )}

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
              'w-7 h-7 rounded-full flex items-center justify-center transition-colors duration-150 active:brightness-90',
              'bg-ink-bg/90 backdrop-blur-sm hover:bg-ink-bg hover:shadow-sm',
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
          {/* 隐藏/显示（NSFW）切换按钮 */}
          {onHideImage && onUnhideImage && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                const hidden = isImageHidden?.(image.id);
                if (hidden) {
                  onUnhideImage(image.id);
                } else {
                  onHideImage(image.id);
                }
              }}
              title={isImageHidden?.(image.id) ? t.header.unhideImage : t.header.markAsNSFW}
              className="w-7 h-7 rounded-full flex items-center justify-center bg-ink-bg/90 backdrop-blur-sm hover:bg-ink-surface hover:shadow-sm active:brightness-90 transition-colors duration-150"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8A8A8A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                {isImageHidden?.(image.id) && (
                  <line x1="1" y1="1" x2="23" y2="23" />
                )}
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* 文件名预览：固定两行高度，避免虚拟行高和实际卡片高度不一致 */}
      <div className="px-3 py-2 border-t border-ink-line h-[52px] overflow-hidden">
        <p className="text-[11px] text-ink-secondary leading-[1.3] overflow-hidden [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical]" title={image.file_name}>
          {image.file_name}
        </p>
      </div>

      {contextMenu && createPortal(
        <div
          className="fixed z-[1200] w-52 rounded-card border border-ink-line bg-ink-bg shadow-2xl p-1 motion-fade-in"
          style={{ left: menuX, top: menuY }}
          onPointerDown={event => event.stopPropagation()}
          onContextMenu={event => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <button
            type="button"
            className="image-context-menu-item"
            onClick={() => runContextAction(onClick)}
          >
            {t.header.openDetail}
          </button>
          <button
            type="button"
            className="image-context-menu-item"
            onClick={() => runContextAction(() => onToggleFavorite(image.id))}
          >
            {image.is_favorite ? t.header.unfavorite : t.header.favorite}
          </button>
          <button
            type="button"
            className="image-context-menu-item"
            onClick={() => runContextAction(() => api.revealImageInFileManager(image.id))}
          >
            {t.header.openInFileManager}
          </button>
          {onHideImage && onUnhideImage && (
            <button
              type="button"
              className="image-context-menu-item"
              onClick={() => runContextAction(() => {
                if (isImageHidden?.(image.id)) {
                  onUnhideImage(image.id);
                } else {
                  onHideImage(image.id);
                }
              })}
            >
              {isImageHidden?.(image.id) ? t.header.unhideImage : t.header.markAsNSFW}
            </button>
          )}
        </div>,
        document.body
      )}
    </div>
  );
});
