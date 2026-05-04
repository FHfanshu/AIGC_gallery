import { useState } from 'react'; // useState: 本地状态
import { Button } from '../ui'; // UI组件: 按钮
import { truncate } from '../../lib/utils'; // 字符串截断工具
import { useI18n, tReplace } from '../../i18n'; // 国际化Hook
import type { AiTagFinished, AiTagProgress, BackupProgress, BackupResult, ImageStats, ImportProgress, ImportResult, ViewType } from '../../types'; // 类型定义
import type { GalleryDensity } from '../gallery/GalleryGrid'; // 网格密度类型
import type { SortField, SortDirection } from '../../hooks/useGallery'; // 排序类型
import { StatusBar } from './StatusBar'; // 左下角后台任务状态

/**
 * @component Sidebar
 * @description 侧边栏组件 - 提供应用导航、图片统计、导入功能、过滤控制、排序、模型列表和设置面板
 */
interface SidebarProps {
  activeView: ViewType; // 当前激活的视图
  onNavigate: (view: ViewType) => void; // 视图切换回调
  stats: ImageStats | null; // 图片统计数据
  onImport: () => void; // 导入PNG回调
  onImportFolder: () => void; // 导入文件夹回调
  hideNSFW: boolean;
  onToggleNSFW: () => void;
  nsfwTags: string[];
  onAddNSFWTag: (tag: string) => void;
  onRemoveNSFWTag: (tag: string) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  refreshProgress?: { done: number; total: number };
  sortBy: SortField;
  onSortByChange: (field: SortField) => void;
  sortDir: SortDirection;
  onSortDirChange: (dir: SortDirection) => void;
  galleryDensity: GalleryDensity;
  onGalleryDensityChange: (density: GalleryDensity) => void;
  importProgress: ImportProgress | null;
  importResult: ImportResult | null;
  reparseProgress: { done: number; total: number } | null;
  backupProgress: BackupProgress | null;
  backupResult: BackupResult | null;
  aiTagProgress: AiTagProgress | null;
  aiTagResult: AiTagFinished | null;
}

export function Sidebar({
  activeView, onNavigate, stats, onImport, onImportFolder,
  hideNSFW, onToggleNSFW, nsfwTags, onAddNSFWTag, onRemoveNSFWTag,
  onRefresh, isRefreshing, refreshProgress,
  sortBy, onSortByChange, sortDir, onSortDirChange,
  galleryDensity, onGalleryDensityChange,
  importProgress, importResult, reparseProgress,
  backupProgress, backupResult, aiTagProgress, aiTagResult,
}: SidebarProps) {
  const { t } = useI18n(); // t: 翻译函数
  const [newNsfwTag, setNewNsfwTag] = useState(''); // NSFW tag input state
  const [showNsfwTagList, setShowNsfwTagList] = useState(false);

  /** 添加NSFW标签（去重+小写化） */
  const handleAddNsfwTag = () => {
    const trimmed = newNsfwTag.trim().toLowerCase();
    if (trimmed && !nsfwTags.includes(trimmed)) {
      onAddNSFWTag(trimmed);
      setNewNsfwTag('');
    }
  };

  return (
    <aside className="w-[280px] min-w-[280px] h-screen flex flex-col bg-ink-bg border-r border-ink-line overflow-hidden">
      <div className="flex-1 min-h-0 overflow-y-auto p-5 flex flex-col gap-6">
      {/* 应用标题 */}
      <div>
        <h1 className="font-display text-display-md text-ink tracking-tight">
          {t.app.title}
        </h1>
      </div>

      {/* 导入按钮区域 */}
      <div className="flex flex-col gap-2">
        <Button variant="primary" onClick={onImport}>
          {t.import.importPngs}
        </Button>
        <Button variant="secondary" size="sm" onClick={onImportFolder}>
          {t.import.importFolder}
        </Button>

      </div>

      {/* 导航菜单 */}
      <nav className="flex flex-col gap-1">
        {(['gallery', 'favorites'] as const).map(v => (
          <button
            key={v}
            onClick={() => onNavigate(v)}
            className={`text-left px-3 py-2 text-sm rounded-btn transition-colors duration-150 ${
              activeView === v
                ? 'bg-ink text-ink-bg font-medium' // 当前激活样式
                : 'text-ink-secondary hover:text-ink hover:bg-ink-surface'
            }`}
          >
            {v === 'gallery' ? t.nav.gallery : t.nav.favorites}
          </button>
        ))}
      </nav>

      {/* ---- 过滤 section ---- */}
      <div className="divider-h" />
      <div className="flex flex-col gap-2">
        <h3 className="text-caption text-ink-muted uppercase tracking-widest">{t.sidebar.filter}</h3>

        {/* NSFW toggle row */}
        <button
          onClick={onToggleNSFW}
          className={`flex items-center justify-between w-full px-3 py-2 text-sm rounded-btn transition-colors ${
            hideNSFW
              ? 'text-ink-faint hover:text-ink-muted hover:bg-ink-surface'
              : 'text-ink-danger bg-red-50 hover:bg-red-100'
          }`}
        >
          <span className="flex items-center gap-2">
            {hideNSFW ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                <line x1="1" y1="1" x2="23" y2="23" />
                <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
            NSFW
          </span>
          <span className="text-xs">{hideNSFW ? t.sidebar.nsfwHidden : t.sidebar.nsfwVisible}</span>
        </button>

        {/* NSFW 标签列表默认折叠，避免侧栏直接暴露敏感词 */}
        <div className="rounded-btn border border-ink-line bg-ink-surface/60 overflow-hidden">
            <button
              type="button"
              onClick={() => setShowNsfwTagList(prev => !prev)}
              className="w-full flex items-center justify-between px-3 py-2 text-xs text-ink-secondary hover:text-ink transition-colors"
            >
              <span>{t.header.nsfwTags}</span>
              <span className="inline-flex items-center gap-1 text-ink-muted">
                {nsfwTags.length}
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className={`transition-transform ${showNsfwTagList ? 'rotate-180' : ''}`}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </span>
            </button>
            {showNsfwTagList && (
              <div className="border-t border-ink-line motion-fade-in">
                {nsfwTags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto px-2.5 py-2">
                    {nsfwTags.sort().map(tag => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-pill text-[11px] font-medium bg-red-50 text-red-600 border border-red-200"
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
                )}
                {/* 添加标签输入（展开区域内底部） */}
                <div className="flex gap-1.5 px-2.5 pb-2 pt-1">
                  <input
                    type="text"
                    value={newNsfwTag}
                    onChange={e => setNewNsfwTag(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAddNsfwTag()}
                    placeholder={t.header.addTagPlaceholder}
                    className="flex-1 px-2 py-1.5 text-xs rounded-btn border border-ink-line bg-ink-surface text-ink placeholder-ink-faint focus-ring"
                  />
                  <button
                    onClick={handleAddNsfwTag}
                    className="px-2.5 py-1.5 text-xs rounded-btn bg-ink text-ink-bg hover:bg-ink/90 transition-colors"
                  >
                    {t.common.add}
                  </button>
                </div>
              </div>
            )}
          </div>

        {/* Refresh button */}
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          className={`flex items-center justify-center gap-2 w-full px-3 py-1.5 text-xs rounded-btn border border-ink-line text-ink-secondary hover:text-ink hover:border-ink-muted transition-colors ${isRefreshing ? 'cursor-wait opacity-70' : ''}`}
        >
          <svg className={isRefreshing ? 'animate-spin' : ''} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" />
            <path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14" />
          </svg>
          {isRefreshing
            ? (refreshProgress?.total ? tReplace(t.sidebar.reparsingProgress, { done: refreshProgress.done, total: refreshProgress.total }) : t.sidebar.reparsing)
            : t.sidebar.reparseMetadata}
        </button>
      </div>

      {/* ---- 排序 section ---- */}
      <div className="divider-h" />
      <div className="flex flex-col gap-2">
        <h3 className="text-caption text-ink-muted uppercase tracking-widest">{t.sidebar.gridSize}</h3>

        {/* 网格密度：默认中等大约一屏四行，小/大用于快速切换可视信息量 */}
        <div className="grid grid-cols-3 gap-1 rounded-btn border border-ink-line bg-ink-surface/60 p-1">
          {(['small', 'medium', 'large'] as const).map(size => (
            <button
              key={size}
              type="button"
              onClick={() => onGalleryDensityChange(size)}
              className={`px-2 py-1.5 text-xs rounded-[8px] transition-colors ${
                galleryDensity === size
                  ? 'bg-ink text-ink-bg font-medium'
                  : 'text-ink-muted hover:text-ink hover:bg-ink-bg'
              }`}
            >
              {size === 'small' ? t.sidebar.gridSmall : size === 'medium' ? t.sidebar.gridMedium : t.sidebar.gridLarge}
            </button>
          ))}
        </div>

        <h3 className="mt-3 text-caption text-ink-muted uppercase tracking-widest">{t.sidebar.sort}</h3>

        {/* Sort field select */}
        <select
          value={sortBy}
          onChange={e => onSortByChange(e.target.value as SortField)}
          className="w-full px-3 py-2 text-xs rounded-btn border border-ink-line bg-ink-bg text-ink-secondary outline-none focus:border-ink-muted cursor-pointer"
        >
          <option value="created_at">{t.header.sortTime}</option>
          <option value="file_name">{t.header.sortFileName}</option>
          <option value="source_type">{t.header.sortSource}</option>
          <option value="dimensions">{t.header.sortDimensions}</option>
          <option value="aspect_ratio">{t.header.sortRatio}</option>
          <option value="model">{t.header.sortModel}</option>
          <option value="prompt">{t.header.sortPrompt}</option>
        </select>

        {/* Sort direction toggle */}
        <button
          onClick={() => onSortDirChange(sortDir === 'asc' ? 'desc' : 'asc')}
          className="flex items-center justify-center gap-2 w-full px-3 py-2 text-xs rounded-btn border border-ink-line text-ink-secondary hover:text-ink hover:border-ink-muted transition-colors"
        >
          {sortDir === 'asc' ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" />
            </svg>
          )}
          {sortDir === 'asc' ? t.sidebar.sortAsc : t.sidebar.sortDesc}
        </button>
      </div>

      {/* 模型列表区域 */}
      {stats && stats.models.length > 0 && (
        <>
          <div className="divider-h" />
          <div className="flex flex-col gap-2">
            <h3 className="text-caption text-ink-muted uppercase tracking-widest">{t.sidebar.models}</h3>
            <div className="flex flex-col gap-1">
              {stats.models.map(m => (
                <div key={m.model} className="flex items-center justify-between px-2 py-1.5 text-sm">
                  <span className="text-ink-secondary truncate mr-2" title={m.model}>
                    {truncate(m.model, 22)} {/* 截断过长模型名 */}
                  </span>
                  <span className="text-[10px] text-ink-faint tabular-nums">{m.count}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <div className="flex-1" />
      </div>

      {/* 左下角后台任务状态：常驻侧栏底部，避免挤压主内容区域 */}
      <StatusBar
        importProgress={importProgress}
        importResult={importResult}
        reparseProgress={reparseProgress}
        isRefreshing={isRefreshing}
        backupProgress={backupProgress}
        backupResult={backupResult}
        aiTagProgress={aiTagProgress}
        aiTagResult={aiTagResult}
      />
    </aside>
  );
}
