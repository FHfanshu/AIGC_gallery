/**
 * 顶部搜索栏组件
 * 提供图片搜索、NSFW内容过滤开关及标签管理面板
 */
import { useState, useRef, useEffect } from 'react';
import { Input } from '../ui';
import { useI18n, tReplace } from '../../i18n';

import type { SortField, SortDirection } from '../../hooks/useGallery';

interface HeaderProps {
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  imageCount: number;
  loadedCount?: number;
  totalCount?: number;
  hideNSFW: boolean;
  onToggleNSFW: () => void;
  nsfwTags: string[];
  onAddNSFWTag: (tag: string) => void;
  onRemoveNSFWTag: (tag: string) => void;
  onRefresh: () => void; // 刷新图库回调
  sortBy: SortField;
  onSortByChange: (field: SortField) => void;
  sortDir: SortDirection;
  onSortDirChange: (dir: SortDirection) => void;
}

/** 顶部栏：搜索框 + NSFW过滤控制 + 图片计数 */
export function Header({
  searchQuery, setSearchQuery, imageCount, loadedCount, totalCount,
  hideNSFW, onToggleNSFW, nsfwTags, onAddNSFWTag, onRemoveNSFWTag, onRefresh,
  sortBy, onSortByChange, sortDir, onSortDirChange,
}: HeaderProps) {
  const { t } = useI18n();
  const [showNSFWPanel, setShowNSFWPanel] = useState(false); // NSFW标签面板显隐
  const [newTag, setNewTag] = useState(''); // 新增标签输入
  const panelRef = useRef<HTMLDivElement>(null); // 面板DOM引用，用于点击外部关闭

  // 点击面板外部时关闭面板
  useEffect(() => {
    if (!showNSFWPanel) return;
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setShowNSFWPanel(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showNSFWPanel]);

  /** 添加NSFW标签（去重+小写化） */
  const handleAddTag = () => {
    const trimmed = newTag.trim().toLowerCase();
    if (trimmed && !nsfwTags.includes(trimmed)) {
      onAddNSFWTag(trimmed);
      setNewTag('');
    }
  };

  return (
    <header className="flex items-center gap-4 px-8 py-4 bg-ink-bg border-b border-ink-line">
      {/* 搜索框 */}
      <div className="relative flex-1 max-w-xl">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </div>
        <Input
          placeholder={t.header.searchPlaceholder}
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="!pl-9 !py-2 !text-sm !bg-ink-surface"
        />
      </div>


      <button
        onClick={onRefresh}
        title={t.common.refresh}
        className="w-8 h-8 rounded-full flex items-center justify-center text-ink-faint hover:text-ink-muted hover:bg-ink-surface transition-colors"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="23 4 23 10 17 10" />
          <polyline points="1 20 1 14 7 14" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" />
          <path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14" />
        </svg>
      </button>

      {/* NSFW控制区 */}
      <div className="relative flex-shrink-0" ref={panelRef}>
        <div className="flex items-center gap-1">
          {/* NSFW显示/隐藏切换按钮 */}
          <button
            onClick={onToggleNSFW}
            title={hideNSFW ? t.header.nsfwHidden : t.header.nsfwVisible}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-btn text-xs font-medium transition-all duration-150 ${
              hideNSFW
                ? 'text-ink-faint hover:text-ink-muted hover:bg-ink-surface'
                : 'text-ink-danger bg-red-50 hover:bg-red-100'
            }`}
          >
            {hideNSFW ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                  <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                  <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                </svg>
                <span>NSFW</span>
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                <span>NSFW</span>
              </>
            )}
          </button>

          {/* NSFW标签编辑按钮 */}
          <button
            onClick={() => setShowNSFWPanel(prev => !prev)}
            title={t.header.editNsfwTags}
            className="w-7 h-7 rounded-full flex items-center justify-center text-ink-faint hover:text-ink-muted transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>

        {/* NSFW标签管理面板 */}
        {showNSFWPanel && (
          <div className="absolute right-0 top-full mt-2 w-80 max-h-96 bg-ink-bg border border-ink-line rounded-card p-4 z-50 overflow-hidden flex flex-col shadow-lg">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-ink">{t.header.nsfwTags}</h3>
              <span className="text-caption text-ink-muted">{nsfwTags.length}</span>
            </div>

            {/* 新增标签输入 */}
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                value={newTag}
                onChange={e => setNewTag(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddTag()}
                placeholder={t.header.addTagPlaceholder}
                className="flex-1 px-2.5 py-1.5 text-xs rounded-btn border border-ink-line bg-ink-surface text-ink placeholder-ink-faint focus-ring"
              />
              <button
                onClick={handleAddTag}
                className="px-3 py-1.5 text-xs rounded-btn bg-ink text-white hover:bg-ink/90 transition-colors"
              >
                {t.common.add}
              </button>
            </div>

            {/* 已有标签列表（可删除） */}
            <div className="flex flex-wrap gap-1.5 overflow-y-auto max-h-60 pr-1">
              {nsfwTags.sort().map(tag => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-pill text-[11px] font-medium bg-red-50 text-red-600 border border-red-200"
                >
                  {tag}
                  <button
                    onClick={() => onRemoveNSFWTag(tag)}
                    className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-red-400 hover:text-red-700 hover:bg-red-100 transition-colors"
                  >
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 排序控制 */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <select
          value={sortBy}
          onChange={e => onSortByChange(e.target.value as SortField)}
          className="px-2 py-1 text-xs rounded-btn border border-ink-line bg-ink-bg text-ink-secondary outline-none focus:border-ink-muted cursor-pointer"
        >
          <option value="created_at">{t.header.sortTime}</option>
          <option value="file_name">{t.header.sortFileName}</option>
          <option value="source_type">{t.header.sortSource}</option>
          <option value="dimensions">{t.header.sortDimensions}</option>
          <option value="aspect_ratio">{t.header.sortRatio}</option>
          <option value="model">{t.header.sortModel}</option>
          <option value="prompt">{t.header.sortPrompt}</option>
        </select>
        <button
          onClick={() => onSortDirChange(sortDir === 'asc' ? 'desc' : 'asc')}
          className="w-7 h-7 rounded-btn flex items-center justify-center text-ink-muted hover:text-ink border border-ink-line hover:border-ink-muted transition-colors"
          title={sortDir === 'asc' ? t.header.sortAsc : t.header.sortDesc}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {sortDir === 'asc' ? (
              <><line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" /></>
            ) : (
              <><line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" /></>
            )}
          </svg>
        </button>
      </div>

      {/* 图片计数 */}
      <div className="text-caption text-ink-muted flex-shrink-0 tracking-widest" title={loadedCount !== undefined && totalCount !== undefined ? `${imageCount} displayed · ${loadedCount}/${totalCount} loaded` : undefined}>
        {tReplace(t.header.count, { count: imageCount })}
        {loadedCount !== undefined && totalCount !== undefined && totalCount > loadedCount && (
          <span className="ml-1 text-ink-faint normal-case tracking-normal">({loadedCount}/{totalCount})</span>
        )}
      </div>
    </header>
  );
}
