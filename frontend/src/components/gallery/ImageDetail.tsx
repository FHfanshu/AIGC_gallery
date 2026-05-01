import { useState, useEffect } from 'react';
import { NeuButton, NeuCard, NeuTag, NeuTextarea } from '../ui';
import { parseMetadata, getSourceLabel, truncate } from '../../lib/utils';
import { api } from '../../lib/tauri';
import { useI18n } from '../../i18n';
import type { ImageRecord, TagRecord, ImageMetadata } from '../../types';

interface ImageDetailProps {
  image: ImageRecord;
  tags: TagRecord[];
  onClose: () => void;
  onDelete: (id: number) => void;
  onToggleFavorite: (imageId: number) => void;
  onUpdateTags: (imageId: number, tagName: string) => void;
  onUpdatePrompt: (imageId: number, positive: string, negative: string) => void;
}

export function ImageDetail({
  image,
  tags,
  onClose,
  onDelete,
  onToggleFavorite,
  onUpdateTags,
  onUpdatePrompt,
}: ImageDetailProps) {
  const { t } = useI18n();
  const [isEditing, setIsEditing] = useState(false);
  const [editPrompt, setEditPrompt] = useState('');
  const [editNegPrompt, setEditNegPrompt] = useState('');
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [imgSrc, setImgSrc] = useState<string>('');

  const meta: ImageMetadata | null = parseMetadata(image.metadata_json);
  const source = meta ? getSourceLabel(meta.source) : null;

  // Load full image as base64
  useEffect(() => {
    let cancelled = false;
    setImgSrc('');
    api.getImageBase64(image.id, false)
      .then(src => { if (!cancelled) setImgSrc(src); })
      .catch(() => {
        if (!cancelled) {
          const fallback = image.stored_path || image.file_path;
          setImgSrc(fallback ? `https://asset.localhost/${fallback.replace(/\\/g, '/')}` : '');
        }
      });
    return () => { cancelled = true; };
  }, [image.id, image.stored_path, image.file_path]);

  useEffect(() => {
    setIsEditing(false);
    setEditPrompt(image.prompt || meta?.prompt || '');
    setEditNegPrompt(image.negative_prompt || meta?.negative_prompt || '');
    setCopiedField(null);
  }, [image.id]);

  const handleCopy = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      // fallback
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

  const handleSavePrompt = () => {
    onUpdatePrompt(image.id, editPrompt, editNegPrompt);
    setIsEditing(false);
  };

  const prompt = image.prompt || meta?.prompt || '';
  const negPrompt = image.negative_prompt || meta?.negative_prompt || '';

  return (
    <aside className="w-[400px] min-w-[400px] h-screen flex flex-col bg-neu-bg border-l border-white/30 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4">
        <h3 className="font-display font-bold text-base text-neu-text">{t.detail.imageDetail}</h3>
        <NeuButton variant="icon" size="sm" onClick={onClose}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </NeuButton>
      </div>

      {/* Preview */}
      <div className="px-5 mb-4">
        <NeuCard padding="sm" className="!rounded-neu-sm overflow-hidden">
          <img
            src={imgSrc}
            alt={image.file_name}
            className="w-full h-auto rounded-neu-sm"
          />
        </NeuCard>
      </div>

      {/* File Info */}
      <div className="px-5 mb-4 space-y-2">
        <div className="flex items-center gap-2">
          {source && (
            <span
              className="px-2 py-0.5 rounded-full text-[10px] font-semibold text-white"
              style={{ backgroundColor: source.color }}
            >
              {source.label}
            </span>
          )}
          {meta?.model && (
            <span className="text-xs text-neu-muted truncate">{truncate(meta.model, 30)}</span>
          )}
        </div>
        <p className="text-xs text-neu-muted">{image.file_name}</p>
        <p className="text-xs text-neu-muted opacity-60">{image.width} x {image.height}</p>
      </div>

      {/* Prompt */}
      <div className="px-5 mb-3">
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-semibold text-neu-muted uppercase tracking-wider">{t.detail.prompt}</label>
          <div className="flex gap-1">
            <NeuButton
              variant="icon"
              size="sm"
              onClick={() => handleCopy(prompt, 'prompt')}
            >
              <span className="text-[10px]">{copiedField === 'prompt' ? t.detail.copied : t.detail.copy}</span>
            </NeuButton>
            <NeuButton
              variant="icon"
              size="sm"
              onClick={() => { setIsEditing(!isEditing); setEditPrompt(prompt); setEditNegPrompt(negPrompt); }}
            >
              <span className="text-[10px]">{isEditing ? t.detail.cancel : t.detail.edit}</span>
            </NeuButton>
          </div>
        </div>
        {isEditing ? (
          <div className="space-y-2">
            <NeuTextarea
              value={editPrompt}
              onChange={e => setEditPrompt(e.target.value)}
              rows={4}
              className="!text-xs"
            />
            <NeuTextarea
              value={editNegPrompt}
              onChange={e => setEditNegPrompt(e.target.value)}
              placeholder={t.detail.negPlaceholder}
              rows={3}
              className="!text-xs"
            />
            <div className="flex gap-2">
              <NeuButton size="sm" variant="primary" onClick={handleSavePrompt}>{t.detail.save}</NeuButton>
              <NeuButton size="sm" onClick={() => setIsEditing(false)}>{t.detail.cancel}</NeuButton>
            </div>
          </div>
        ) : (
          <NeuTextarea readOnly value={prompt} rows={4} className="!text-xs !cursor-default" />
        )}
      </div>

      {/* Negative Prompt (view mode) */}
      {!isEditing && negPrompt && (
        <div className="px-5 mb-3">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold text-neu-muted uppercase tracking-wider">{t.detail.negativePrompt}</label>
            <NeuButton
              variant="icon"
              size="sm"
              onClick={() => handleCopy(negPrompt, 'negPrompt')}
            >
              <span className="text-[10px]">{copiedField === 'negPrompt' ? t.detail.copied : t.detail.copy}</span>
            </NeuButton>
          </div>
          <NeuTextarea readOnly value={negPrompt} rows={3} className="!text-xs !cursor-default" />
        </div>
      )}

      {/* Characters (NovelAI v4) */}
      {meta?.characters && meta.characters.length > 0 && (
        <div className="px-5 mb-3">
          <label className="text-xs font-semibold text-neu-muted uppercase tracking-wider mb-2 block">
            {t.detail.characters} ({meta.characters.length})
          </label>
          <div className="space-y-2">
            {meta.characters.map((ch, i) => (
              <NeuCard key={i} padding="sm" className="!rounded-neu-sm">
                <div className="flex items-start justify-between gap-2">
                  <NeuTextarea readOnly value={ch.caption} rows={2} className="!text-[11px] !cursor-default flex-1" />
                  <NeuButton
                    variant="icon"
                    size="sm"
                    onClick={() => handleCopy(ch.caption, `char-${i}`)}
                  >
                    <span className="text-[10px]">{copiedField === `char-${i}` ? t.detail.copied : t.detail.copy}</span>
                  </NeuButton>
                </div>
              </NeuCard>
            ))}
          </div>
        </div>
      )}

      {/* Parameters */}
      {meta && (
        <div className="px-5 mb-4">
          <label className="text-xs font-semibold text-neu-muted uppercase tracking-wider mb-2 block">{t.detail.parameters}</label>
          <div className="grid grid-cols-2 gap-2">
            {meta.steps && (
              <NeuCard padding="sm" className="!rounded-neu-sm">
                <p className="text-[10px] text-neu-muted uppercase">{t.detail.steps}</p>
                <p className="text-sm font-medium text-neu-text">{meta.steps}</p>
              </NeuCard>
            )}
            {meta.cfg_scale && (
              <NeuCard padding="sm" className="!rounded-neu-sm">
                <p className="text-[10px] text-neu-muted uppercase">CFG</p>
                <p className="text-sm font-medium text-neu-text">{meta.cfg_scale}</p>
              </NeuCard>
            )}
            {meta.seed && (
              <NeuCard padding="sm" className="!rounded-neu-sm">
                <p className="text-[10px] text-neu-muted uppercase">{t.detail.seed}</p>
                <p className="text-sm font-medium text-neu-text">{meta.seed}</p>
              </NeuCard>
            )}
            {meta.sampler && (
              <NeuCard padding="sm" className="!rounded-neu-sm">
                <p className="text-[10px] text-neu-muted uppercase">{t.detail.sampler}</p>
                <p className="text-sm font-medium text-neu-text truncate" title={meta.sampler}>{truncate(meta.sampler, 16)}</p>
              </NeuCard>
            )}
            {meta.width && meta.height && (
              <NeuCard padding="sm" className="!rounded-neu-sm">
                <p className="text-[10px] text-neu-muted uppercase">{t.detail.size}</p>
                <p className="text-sm font-medium text-neu-text">{meta.width} x {meta.height}</p>
              </NeuCard>
            )}
          </div>
        </div>
      )}

      {/* Tags */}
      <div className="px-5 mb-4">
        <label className="text-xs font-semibold text-neu-muted uppercase tracking-wider mb-2 block">{t.sidebar.tags}</label>
        <div className="flex flex-wrap gap-2">
          {tags.map(tag => (
            <NeuTag
              key={tag.id}
              name={tag.name}
              color={tag.color}
              active={image.tags.includes(tag.name)}
              onToggle={() => onUpdateTags(image.id, tag.name)}
            />
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="px-5 py-4 mt-auto flex gap-2">
        <NeuButton
          variant="icon"
          size="lg"
          onClick={() => onToggleFavorite(image.id)}
          className={image.is_favorite ? '!text-[#E53E3E]' : ''}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill={image.is_favorite ? '#E53E3E' : 'none'}
            stroke={image.is_favorite ? '#E53E3E' : '#6B7280'}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
        </NeuButton>
        <div className="flex-1" />
        <NeuButton variant="danger" size="sm" onClick={() => onDelete(image.id)}>
          {t.detail.delete}
        </NeuButton>
      </div>
    </aside>
  );
}
