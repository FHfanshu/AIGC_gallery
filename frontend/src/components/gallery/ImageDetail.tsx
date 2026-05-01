/**
 * 图片详情面板组件
 * 以侧边栏形式展示选中图片的预览、文件信息、提示词、生成参数，支持编辑和复制
 */
import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Button, Card, Textarea } from '../ui';
import { parseMetadata, getSourceLabel, truncate } from '../../lib/utils';
import { api } from '../../lib/tauri';
import { useI18n } from '../../i18n';
import type { CivitaiLookupResult, ImageRecord, ImageMetadata } from '../../types';

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
  const [isPreviewOpen, setIsPreviewOpen] = useState(false); // 原图预览遮罩
  const [previewScale, setPreviewScale] = useState(1); // 原图预览缩放倍率
  const [previewOffset, setPreviewOffset] = useState({ x: 0, y: 0 }); // 原图预览平移偏移
  const [civitaiResults, setCivitaiResults] = useState<Record<string, CivitaiLookupResult | null>>({});
  const [civitaiLoadingHash, setCivitaiLoadingHash] = useState<string | null>(null);
  const [civitaiError, setCivitaiError] = useState<string | null>(null);
  const dragRef = useRef({ active: false, x: 0, y: 0, startX: 0, startY: 0 });

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

  const handleCivitaiLookup = async (hash: string) => {
    setCivitaiError(null);
    setCivitaiLoadingHash(hash);
    try {
      const result = await api.lookupCivitaiByHash(hash);
      setCivitaiResults(prev => ({ ...prev, [hash]: result }));
    } catch (e) {
      setCivitaiError(e instanceof Error ? e.message : String(e));
    } finally {
      setCivitaiLoadingHash(null);
    }
  };

  // 预览层打开时锁住底层页面滚动，并注册全局兜底事件。
  useEffect(() => {
    if (!isPreviewOpen) return;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsPreviewOpen(false);
    };
    const handlePointerEnd = () => {
      dragRef.current.active = false;
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('pointerup', handlePointerEnd);
    window.addEventListener('pointercancel', handlePointerEnd);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('pointerup', handlePointerEnd);
      window.removeEventListener('pointercancel', handlePointerEnd);
    };
  }, [isPreviewOpen]);

  const handlePreviewWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setPreviewScale(prev => {
      const next = event.deltaY < 0 ? prev * 1.12 : prev / 1.12;
      return Math.min(8, Math.max(0.2, next));
    });
  };

  const handlePreviewPointerDown = (event: React.PointerEvent<HTMLImageElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = {
      active: true,
      x: event.clientX,
      y: event.clientY,
      startX: previewOffset.x,
      startY: previewOffset.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePreviewPointerMove = (event: React.PointerEvent<HTMLImageElement>) => {
    if (!dragRef.current.active) return;
    event.preventDefault();
    event.stopPropagation();
    const dx = event.clientX - dragRef.current.x;
    const dy = event.clientY - dragRef.current.y;
    setPreviewOffset({
      x: dragRef.current.startX + dx,
      y: dragRef.current.startY + dy,
    });
  };

  const handlePreviewPointerUp = (event: React.PointerEvent<HTMLImageElement>) => {
    dragRef.current.active = false;
    event.stopPropagation();
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const prompt = image.prompt || meta?.prompt || '';
  const negPrompt = image.negative_prompt || meta?.negative_prompt || '';
  const novelai = meta?.novelai;
  const novelaiSummary = [
    novelai?.software && [t.detail.software, novelai.software],
    novelai?.source && [t.detail.source, novelai.source],
    novelai?.request_type && [t.detail.request, novelai.request_type],
    novelai?.generation_time && [t.detail.generationTime, novelai.generation_time],
    typeof novelai?.uncond_per_vibe === 'boolean' && [t.detail.uncondVibe, novelai.uncond_per_vibe ? 'true' : 'false'],
    typeof novelai?.wonky_vibe_correlation === 'boolean' && [t.detail.wonkyVibe, novelai.wonky_vibe_correlation ? 'true' : 'false'],
  ].filter(Boolean) as [string, string][];

  return (
    <aside className="w-[400px] min-w-[400px] h-screen flex flex-col bg-ink-bg border-l border-ink-line overflow-y-auto motion-detail-panel-in">
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
        <button
          type="button"
          onClick={() => {
            if (!imgSrc) return;
            setPreviewScale(1);
            setPreviewOffset({ x: 0, y: 0 });
            setIsPreviewOpen(true);
          }}
          className="block w-full rounded-card overflow-hidden border border-ink-line cursor-zoom-in bg-ink-surface transition-colors duration-200 hover:border-ink-muted"
          title={t.detail.previewOriginal}
        >
          <img
            src={imgSrc}
            alt={image.file_name}
            className="w-full h-auto"
          />
        </button>
      </div>

      {/* 文件信息（来源、模型、尺寸） */}
      <div className="px-5 py-3 border-b border-ink-line space-y-1.5">
        <div className="flex items-center gap-2">
          {source && (
            <span
              className="px-2 py-0.5 rounded-pill text-[10px] font-semibold text-white uppercase tracking-wider backdrop-blur-sm"
              style={{ backgroundColor: source.color }}
            >
              {source.label}
            </span>
          )}
          {meta?.model && (
            <span className="text-xs text-ink-muted truncate">{truncate(meta.model, 30)}</span>
          )}
        </div>
        {meta?.model_hash && (
          <div className="text-[10px] text-ink-muted break-all">
            <span>{t.detail.checkpointHash} {meta.model_hash}</span>
            <button
              className="ml-2 text-ink underline underline-offset-2"
              onClick={() => handleCivitaiLookup(meta.model_hash!)}
            >
              {civitaiLoadingHash === meta.model_hash ? t.detail.lookingUp : 'Civitai'}
            </button>
            {civitaiResults[meta.model_hash] && (
              <p className="mt-1 text-ink-secondary">
                {civitaiResults[meta.model_hash]?.model_name} · {civitaiResults[meta.model_hash]?.version_name}
                {civitaiResults[meta.model_hash]?.page_url && (
                  <button
                    className="ml-2 text-ink underline underline-offset-2"
                    onClick={() => api.openUrl(civitaiResults[meta.model_hash]!.page_url!)}
                  >
                    打开
                  </button>
                )}
              </p>
            )}
            {civitaiResults[meta.model_hash] === null && <p className="mt-1 text-ink-muted">{t.detail.notFoundOnCivitai}</p>}
          </div>
        )}
        {meta?.loras && meta.loras.length > 0 && (
          <div className="space-y-1">
            <p className="text-[10px] text-ink-muted uppercase tracking-widest">{t.detail.loraHash}</p>
            <div className="space-y-1">
              {meta.loras.map((lora, index) => (
                <div key={`${lora.name}-${index}`} className="text-[10px] text-ink-secondary break-all leading-4">
                  <span className="font-medium text-ink">{lora.name}</span>
                  {lora.weight && <span className="ml-1 text-ink-muted">({lora.weight})</span>}
                  {lora.hash && (
                    <>
                      <span className="ml-1 text-ink-muted">[{lora.hash}]</span>
                      <button
                        className="ml-1 text-ink underline underline-offset-2"
                        onClick={() => handleCivitaiLookup(lora.hash!)}
                      >
                        {civitaiLoadingHash === lora.hash ? t.detail.lookingUp : 'Civitai'}
                      </button>
                    </>
                  )}
                  {lora.hash && civitaiResults[lora.hash] && (
                    <p className="mt-0.5 text-ink-muted">
                      {civitaiResults[lora.hash]?.model_name} · {civitaiResults[lora.hash]?.version_name}
                      {civitaiResults[lora.hash]?.page_url && (
                        <button
                          className="ml-2 text-ink underline underline-offset-2"
                          onClick={() => api.openUrl(civitaiResults[lora.hash!]!.page_url!)}
                        >
                          打开
                        </button>
                      )}
                    </p>
                  )}
                  {lora.hash && civitaiResults[lora.hash] === null && (
                    <p className="mt-0.5 text-ink-muted">{t.detail.notFoundOnCivitai}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        {civitaiError && <p className="text-[10px] text-ink-danger break-all">{civitaiError}</p>}
        <p className="text-xs text-ink-secondary">{image.file_name}</p>
        <p className="text-[10px] text-ink-faint tabular-nums">{image.width} x {image.height}</p>
      </div>

      {/* 正向提示词（支持编辑和复制） */}
      <div className="px-5 py-3 border-b border-ink-line">
        <div className="flex items-center justify-between mb-2">
          <label className="text-caption text-ink-muted uppercase tracking-widest">{t.detail.prompt}</label>
          <div className="flex gap-1.5">
            <Button variant="secondary" size="sm" onClick={() => handleCopy(prompt, 'prompt')}>
              <span className="text-xs">{copiedField === 'prompt' ? t.detail.copied : t.detail.copy}</span>
            </Button>
            <Button variant="secondary" size="sm" onClick={() => { setIsEditing(!isEditing); setEditPrompt(prompt); setEditNegPrompt(negPrompt); }}>
              <span className="text-xs">{isEditing ? t.detail.cancel : t.detail.edit}</span>
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
            <Button variant="secondary" size="sm" onClick={() => handleCopy(negPrompt, 'negPrompt')}>
              <span className="text-xs">{copiedField === 'negPrompt' ? t.detail.copied : t.detail.copy}</span>
            </Button>
          </div>
          <Textarea readOnly value={negPrompt} rows={3} className="!text-xs !cursor-default !bg-ink-surface" />
        </div>
      )}

      {/* NovelAI 扩展信息 */}
      {novelai && (novelaiSummary.length > 0 || novelai.references.length > 0 || novelai.signed_hash) && (
        <div className="px-5 py-3 border-b border-ink-line">
          <label className="text-caption text-ink-muted uppercase tracking-widest mb-2 block">NovelAI</label>
          {novelaiSummary.length > 0 && (
            <div className="grid grid-cols-2 gap-2 mb-3">
              {novelaiSummary.map(([label, value]) => (
                <div key={label} className="px-3 py-2 rounded-card border border-ink-line bg-ink-surface min-w-0">
                  <p className="text-[10px] text-ink-muted uppercase tracking-widest">{label}</p>
                  <p className="text-[11px] font-medium text-ink mt-0.5 break-all">{truncate(value, 54)}</p>
                </div>
              ))}
            </div>
          )}
          {novelai.references.length > 0 && (
            <div className="space-y-2">
              {novelai.references.map((ref, index) => (
                <Card key={`${ref.kind}-${index}`} padding="sm" bordered>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <p className="text-[10px] text-ink-muted uppercase tracking-widest">{ref.label}</p>
                    <Button variant="ghost" size="sm" onClick={() => handleCopy(JSON.stringify(ref, null, 2), `nai-ref-${index}`)}>
                      <span className="text-[10px]">{copiedField === `nai-ref-${index}` ? t.detail.copied : t.detail.copy}</span>
                    </Button>
                  </div>
                  {ref.descriptions.length > 0 && (
                    <Textarea readOnly value={ref.descriptions.join('\n\n')} rows={Math.min(4, ref.descriptions.length + 1)} className="!text-[11px] !cursor-default !bg-ink-surface mb-2" />
                  )}
                  <div className="grid grid-cols-3 gap-1.5 text-[10px] text-ink-muted tabular-nums">
                    {ref.strengths.length > 0 && <span>strength {ref.strengths.join(', ')}</span>}
                    {ref.information_extracted.length > 0 && <span>info {ref.information_extracted.join(', ')}</span>}
                    {ref.secondary_strengths.length > 0 && <span>secondary {ref.secondary_strengths.join(', ')}</span>}
                  </div>
                </Card>
              ))}
            </div>
          )}
          {novelai.signed_hash && (
            <div className="mt-3 text-[10px] text-ink-muted break-all">
              <span className="uppercase tracking-widest text-ink-faint">Signed Hash </span>{novelai.signed_hash}
              <button className="ml-2 text-ink underline underline-offset-2" onClick={() => handleCopy(novelai.signed_hash!, 'nai-hash')}>
                {copiedField === 'nai-hash' ? t.detail.copied : t.detail.copy}
              </button>
            </div>
          )}
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
                  <Button variant="secondary" size="sm" onClick={() => handleCopy(ch.caption, `char-${i}`)}>
                    <span className="text-xs">{copiedField === `char-${i}` ? t.detail.copied : t.detail.copy}</span>
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
              meta.cfg_scale && [t.detail.cfg, meta.cfg_scale],
              meta.seed && [t.detail.seed, meta.seed],
              meta.sampler && [t.detail.sampler, truncate(meta.sampler, 16)],
              (meta.width && meta.height) && [t.detail.size, `${meta.width} x ${meta.height}`],
            ].filter(Boolean).map(([label, value]) => (
              <div key={label as string} className="px-3 py-2 rounded-card border border-ink-line bg-ink-surface">
                <p className="text-[10px] text-ink-muted uppercase tracking-widest">{label}</p>
                <p className="text-sm font-medium text-ink mt-0.5 tabular-nums">{value}</p>
              </div>
            ))}
          </div>
        </div>
      )}


      {/* 底部操作栏：收藏 + 删除 */}
      <div className="px-5 py-4 mt-auto flex items-center gap-2 border-t border-ink-line">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onToggleFavorite(image.id)}
          className={image.is_favorite ? '!text-ink-danger' : ''}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill={image.is_favorite ? '#DC2626' : 'none'}
            stroke={image.is_favorite ? '#DC2626' : '#8A8A8A'}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
          <span className="text-xs">{image.is_favorite ? t.detail.favorited : t.detail.favorite}</span>
        </Button>
        <div className="flex-1" />
        <Button
          variant="danger"
          size="sm"
          onClick={() => {
            if (window.confirm(t.detail.confirmDelete)) {
              onDelete(image.id);
            }
          }}
        >
          {t.detail.delete}
        </Button>
      </div>

      {isPreviewOpen && createPortal(
        <div
          className="fixed inset-0 z-[1000] bg-black/95 overflow-hidden cursor-zoom-out overscroll-contain touch-none"
          onClick={() => setIsPreviewOpen(false)}
          onWheel={handlePreviewWheel}
        >
          <div className="w-screen h-screen flex items-center justify-center p-6 overflow-hidden">
            <img
              src={imgSrc}
              alt={image.file_name}
              className="max-w-full max-h-full object-contain select-none transition-transform duration-75 ease-out cursor-grab active:cursor-grabbing"
              style={{ transform: `translate3d(${previewOffset.x}px, ${previewOffset.y}px, 0) scale(${previewScale})` }}
              draggable={false}
              onClick={event => event.stopPropagation()}
              onPointerDown={handlePreviewPointerDown}
              onPointerMove={handlePreviewPointerMove}
              onPointerUp={handlePreviewPointerUp}
              onPointerCancel={handlePreviewPointerUp}
            />
          </div>
          <div className="fixed left-1/2 bottom-5 -translate-x-1/2 px-3 py-1.5 rounded-full bg-black/60 text-white text-xs tabular-nums pointer-events-none">
            {t.detail.previewHelp} {Math.round(previewScale * 100)}%
          </div>
        </div>,
        document.body
      )}
    </aside>
  );
}
