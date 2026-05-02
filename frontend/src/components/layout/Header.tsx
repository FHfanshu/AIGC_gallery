/**
 * 顶部搜索栏组件
 * 精简版：仅保留搜索框（含自动补全）、随机图片按钮和图片计数
 * NSFW 过滤、排序、刷新操作已迁移到 Sidebar
 */
import { useState, useEffect, useMemo } from 'react';
import { Input } from '../ui';
import { useI18n, tReplace } from '../../i18n';

interface HeaderProps {
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  imageCount: number;
  totalCount?: number;
  onRandomImage?: () => void;
  randomDisabled?: boolean;
  onOpenSettings?: () => void;
  searchCandidates?: string[];
}

/** 顶部栏：搜索框 + 随机图片 + 图片计数 */
export function Header({
  searchQuery, setSearchQuery, imageCount, totalCount,
  onRandomImage, randomDisabled = false, onOpenSettings, searchCandidates = [],
}: HeaderProps) {
  const { t } = useI18n();
  const [searchFocused, setSearchFocused] = useState(false);
  const [activeCandidateIndex, setActiveCandidateIndex] = useState(0);

  const currentSearchToken = useMemo(() => {
    const lastComma = searchQuery.lastIndexOf(',');
    return searchQuery.slice(lastComma + 1).trim().toLowerCase();
  }, [searchQuery]);

  const visibleCandidates = useMemo(() => {
    if (!searchFocused || currentSearchToken.length < 1) return [];
    const existing = new Set(searchQuery.split(',').map(part => part.trim().toLowerCase()).filter(Boolean));
    return searchCandidates
      .filter(tag => {
        const normalized = tag.toLowerCase();
        return normalized.includes(currentSearchToken) && !existing.has(normalized);
      })
      .slice(0, 6);
  }, [currentSearchToken, searchCandidates, searchFocused, searchQuery]);

  useEffect(() => {
    setActiveCandidateIndex(0);
  }, [currentSearchToken]);

  const inlineCompletion = useMemo(() => {
    const candidate = visibleCandidates[activeCandidateIndex] ?? visibleCandidates[0];
    if (!candidate || !currentSearchToken) return '';
    return candidate.toLowerCase().startsWith(currentSearchToken) ? candidate.slice(currentSearchToken.length) : '';
  }, [activeCandidateIndex, currentSearchToken, visibleCandidates]);

  const displayCompletion = useMemo(() => {
    if (!inlineCompletion) return '';
    return `${searchQuery}${inlineCompletion}`;
  }, [inlineCompletion, searchQuery]);

  const applySearchCandidate = (candidate: string) => {
    const lastComma = searchQuery.lastIndexOf(',');
    const prefix = lastComma >= 0 ? searchQuery.slice(0, lastComma + 1).trimEnd() + ' ' : '';
    setSearchQuery(`${prefix}${candidate}`);
    setActiveCandidateIndex(0);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (visibleCandidates.length === 0) return;
    if (e.key === 'Tab' || e.key === 'Enter') {
      e.preventDefault();
      applySearchCandidate(visibleCandidates[activeCandidateIndex] ?? visibleCandidates[0]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveCandidateIndex(prev => (prev + 1) % visibleCandidates.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveCandidateIndex(prev => (prev - 1 + visibleCandidates.length) % visibleCandidates.length);
    } else if (e.key === 'Escape') {
      setSearchFocused(false);
    }
  };

  return (
    <header className="flex items-center gap-4 px-8 py-4 bg-ink-bg border-b border-ink-line">
      {/* 搜索框 */}
      <div className="relative flex-1 max-w-2xl">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </div>
        {displayCompletion && (
          <div className="absolute inset-0 pointer-events-none flex items-center rounded-btn border border-transparent px-3 py-2 text-sm text-ink-faint overflow-hidden">
            <span className="pl-6 whitespace-pre text-transparent">{searchQuery}</span>
            <span className="whitespace-pre">{inlineCompletion}</span>
          </div>
        )}
        <Input
          placeholder={t.header.searchPlaceholder}
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => window.setTimeout(() => setSearchFocused(false), 120)}
          onKeyDown={handleSearchKeyDown}
          className="!pl-9 !py-2 !text-sm !bg-transparent relative z-10"
        />
        {visibleCandidates.length > 0 && (
          <div className="absolute left-0 right-0 top-full mt-2 z-50 rounded-card border border-ink-line bg-ink-bg shadow-lg overflow-hidden motion-fade-in">
            <div className="px-3 py-2 text-[10px] uppercase tracking-widest text-ink-faint border-b border-ink-line">
              {t.header.searchCandidates}
              <span className="normal-case tracking-normal ml-2 text-ink-muted">Tab</span>
            </div>
            <div className="py-1">
              {visibleCandidates.map((candidate, index) => (
                <button
                  key={candidate}
                  type="button"
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => applySearchCandidate(candidate)}
                  className={`w-full flex items-center justify-between px-3 py-1.5 text-left text-xs transition-colors ${
                    index === activeCandidateIndex ? 'bg-ink-surface text-ink' : 'text-ink-secondary hover:bg-ink-surface'
                  }`}
                >
                  <span className="truncate">{candidate}</span>
                  {index === activeCandidateIndex && <span className="text-[10px] text-ink-faint">Tab</span>}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 随机图片按钮 */}
      <button
        onClick={onRandomImage}
        disabled={randomDisabled}
        title={t.header.randomImage}
        className={`w-8 h-8 rounded-full flex items-center justify-center text-ink-faint hover:text-ink-muted hover:bg-ink-surface transition-colors ml-auto ${randomDisabled ? 'opacity-40 cursor-not-allowed' : ''}`}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="16 3 21 3 21 8" />
          <line x1="4" y1="20" x2="21" y2="3" />
          <polyline points="21 16 21 21 16 21" />
          <line x1="15" y1="15" x2="21" y2="21" />
          <line x1="4" y1="4" x2="9" y2="9" />
        </svg>
      </button>

      <button
        onClick={onOpenSettings}
        title={t.nav.settings}
        className="w-8 h-8 rounded-full flex items-center justify-center text-ink-faint hover:text-ink-muted hover:bg-ink-surface transition-colors"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      {/* 图片计数 */}
      <div className="text-caption text-ink-muted flex-shrink-0 tracking-widest">
        {totalCount !== undefined && totalCount !== imageCount
          ? tReplace(t.header.countFiltered, { count: imageCount, total: totalCount })
          : tReplace(t.header.count, { count: imageCount })}
      </div>
    </header>
  );
}
