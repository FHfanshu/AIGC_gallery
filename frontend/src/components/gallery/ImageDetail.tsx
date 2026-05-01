/**
 * 图片详情面板组件
 * 以侧边栏形式展示选中图片的预览、文件信息、提示词、生成参数，支持编辑和复制
 */
import { useState, useEffect } from 'react';
import { Button, Card, Textarea } from '../ui';
import { parseMetadata, getSourceLabel, truncate } from '../../lib/utils';
import { api } from '../../lib/tauri';
import { useI18n } from '../../i18n';
import type { ImageRecord, ImageMetadata } from '../../types';

interface ImageDetailProps {
  image: ImageRecord;
  onClose: () => void;
  onDelete: (id: number) => void;
  onToggleFavorite: (imageId: number) => void;
  onUpdatePrompt: (imageId: number, positive: string, negative: string) => void;
}

/** 图片详情面板：展示图片预览、提示词（可编辑）、参数、角色描述，并提供收藏/删除操作 */
export function ImageDetail({
  image, onClose, onDelete, onToggleFavorite, onUpdatePrompt,
}: ImageDetailProps) {
  const { t } = useI18n();
  const [isEditing, setIsEditing] = useState(false); // 提示词编辑模式
  const [editPrompt, setEditPrompt] = useState('');
  const [editNegPrompt, setEditNegPrompt] = useState('');
  const [copiedField, setCopiedField] = useState<string | null>(null); // 已复制字段标识
  const [imgSrc, setImgSrc] = useState<string>(''); // 全尺寸预览图 base64

  const meta: ImageMetadata | null = parseMetadata(image.metadata_json); // 解析元数据 JSON
  const source = meta ? getSourceLabel(meta.source) : null;

  // 加载全尺寸图片（非缩略图）
  useEffect(() => {
    let cancelled = false;
    setImgSrc('');
    api.getImageBase64(image.id, false)
      .then(src => { if (!cancelled) setImgSrc(src); })
      .catch(() => {
        if (!cancelled) {
          setImgSrc('');
        }
      });
    return () => { cancelled = true; };
  }, [image.id, image.stored_path, image.file_path]);

  // 切换图片时重置编辑状态
  useEffect(() => {
    setIsEditing(false);
    setEditPrompt(image.prompt || meta?.prompt || '');
    setEditNegPrompt(image.negative_prompt || meta?.negative_prompt || '');
    setCopiedField(null);
  }, [image.id]);

  /** 复制文本到剪贴板，失败时降级使用 execCommand */
  const handleCopy = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000); // 2秒后恢复
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    }
  };

  /** 保存编辑后的提示词 */
  const handleSavePrompt = () => {
    onUpdatePrompt(image.id, editPrompt, editNegPrompt);
    setIsEditing(false);
  };

  const prompt = image.prompt || meta?.prompt || '';
  const negPrompt = image.negative_prompt || meta?.negative_prompt || '';

  return (
    <aside className="w-[400px] min-w-[400px] h-screen flex flex-col bg-ink-bg border-l border-ink-line overflow-y-auto">
      {/* 顶部标题栏 */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-ink-line">
        <h3 className="font-display font-bold text-sm text-ink uppercase tracking-wider">{t.detail.imageDetail}</h3>
        <Button variant="icon" size="sm" onClick={onClose}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </Button>
      </div>

      {/* 图片预览 */}
      <div className="px-5 py-4 border-b border-ink-line">
        <div className="rounded-card overflow-hidden border border-ink-line">
          <img
            src={imgSrc}
            alt={image.file_name}
            className="w-full h-auto"
          />
        </div>
      </div>

      {/* 文件信息（来源、模型、尺寸） */}
      <div className="px-5 py-3 border-b border-ink-line space-y-1.5">
        <div className="flex items-center gap-2">
          {source && (
            <span
              className="px-2 py-0.5 rounded-pill text-[9px] font-semibold text-white uppercase tracking-wider"
              style={{ backgroundColor: source.color }}
            >
              {source.label}
            </span>
          )}
          {meta?.model && (
            <span className="text-xs text-ink-muted truncate">{truncate(meta.model, 30)}</span>
          )}
        </div>
        <p className="text-xs text-ink-secondary">{image.file_name}</p>
        <p className="text-[10px] text-ink-faint tabular-nums">{image.width} x {image.height}</p>
      </div>

      {/* 正向提示词（支持编辑和复制） */}
      <div className="px-5 py-3 border-b border-ink-line">
        <div className="flex items-center justify-between mb-2">
          <label className="text-caption text-ink-muted uppercase tracking-widest">{t.detail.prompt}</label>
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={() => handleCopy(prompt, 'prompt')}>
              <span className="text-[10px]">{copiedField === 'prompt' ? t.detail.copied : t.detail.copy}</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setIsEditing(!isEditing); setEditPrompt(prompt); setEditNegPrompt(negPrompt); }}>
              <span className="text-[10px]">{isEditing ? t.detail.cancel : t.detail.edit}</span>
            </Button>
          </div>
        </div>
        {isEditing ? (
          // 编辑模式：正向+负向提示词输入
          <div className="space-y-2">
            <Textarea value={editPrompt} onChange={e => setEditPrompt(e.target.value)} rows={4} className="!text-xs" />
            <Textarea value={editNegPrompt} onChange={e => setEditNegPrompt(e.target.value)} placeholder={t.detail.negPlaceholder} rows={3} className="!text-xs" />
            <div className="flex gap-2">
              <Button size="sm" variant="primary" onClick={handleSavePrompt}>{t.detail.save}</Button>
              <Button size="sm" variant="ghost" onClick={() => setIsEditing(false)}>{t.detail.cancel}</Button>
            </div>
          </div>
        ) : (
          // 只读模式
          <Textarea readOnly value={prompt} rows={4} className="!text-xs !cursor-default !bg-ink-surface" />
        )}
      </div>

      {/* 负向提示词（仅非编辑模式且有内容时显示） */}
      {!isEditing && negPrompt && (
        <div className="px-5 py-3 border-b border-ink-line">
          <div className="flex items-center justify-between mb-2">
            <label className="text-caption text-ink-muted uppercase tracking-widest">{t.detail.negativePrompt}</label>
            <Button variant="ghost" size="sm" onClick={() => handleCopy(negPrompt, 'negPrompt')}>
              <span className="text-[10px]">{copiedField === 'negPrompt' ? t.detail.copied : t.detail.copy}</span>
            </Button>
          </div>
          <Textarea readOnly value={negPrompt} rows={3} className="!text-xs !cursor-default !bg-ink-surface" />
        </div>
      )}

      {/* 角色描述列表 */}
      {meta?.characters && meta.characters.length > 0 && (
        <div className="px-5 py-3 border-b border-ink-line">
          <label className="text-caption text-ink-muted uppercase tracking-widest mb-2 block">
            {t.detail.characters} ({meta.characters.length})
          </label>
          <div className="space-y-2">
            {meta.characters.map((ch, i) => (
              <Card key={i} padding="sm" bordered>
                <div className="flex items-start justify-between gap-2">
                  <Textarea readOnly value={ch.caption} rows={2} className="!text-[11px] !cursor-default !bg-ink-surface flex-1" />
                  <Button variant="ghost" size="sm" onClick={() => handleCopy(ch.caption, `char-${i}`)}>
                    <span className="text-[10px]">{copiedField === `char-${i}` ? t.detail.copied : t.detail.copy}</span>
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* 生成参数（steps、CFG、seed、采样器、尺寸） */}
      {meta && (
        <div className="px-5 py-3 border-b border-ink-line">
          <label className="text-caption text-ink-muted uppercase tracking-widest mb-2 block">{t.detail.parameters}</label>
          <div className="grid grid-cols-2 gap-2">
            {[
              meta.steps && [t.detail.steps, meta.steps],
              meta.cfg_scale && ['CFG', meta.cfg_scale],
              meta.seed && [t.detail.seed, meta.seed],
              meta.sampler && [t.detail.sampler, truncate(meta.sampler, 16)],
              (meta.width && meta.height) && [t.detail.size, `${meta.width} x ${meta.height}`],
            ].filter(Boolean).map(([label, value]) => (
              <div key={label as string} className="px-3 py-2 rounded-card border border-ink-line bg-ink-surface">
                <p className="text-[9px] text-ink-faint uppercase tracking-widest">{label}</p>
                <p className="text-sm font-medium text-ink mt-0.5 tabular-nums">{value}</p>
              </div>
            ))}
          </div>
        </div>
      )}


      {/* 底部操作栏：收藏 + 删除 */}
      <div className="px-5 py-4 mt-auto flex gap-2">
        <Button
          variant="icon"
          size="lg"
          onClick={() => onToggleFavorite(image.id)}
          className={image.is_favorite ? '!text-ink-danger' : ''}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill={image.is_favorite ? '#DC2626' : 'none'}
            stroke={image.is_favorite ? '#DC2626' : '#8A8A8A'}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
        </Button>
        <div className="flex-1" />
        <Button variant="danger" size="sm" onClick={() => onDelete(image.id)}>
          {t.detail.delete}
        </Button>
      </div>
    </aside>
  );
}
