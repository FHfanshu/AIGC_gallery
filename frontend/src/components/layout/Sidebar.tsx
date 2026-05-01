import { useState, useEffect, useRef } from 'react'; // useState: 本地状态, useEffect: 副作用, useRef: DOM引用
import { Button, Card, Input } from '../ui'; // UI组件: 按钮、卡片、输入框
import { truncate } from '../../lib/utils'; // 字符串截断工具
import { api } from '../../lib/tauri'; // Tauri IPC API封装
import { useI18n } from '../../i18n'; // 国际化Hook
import type { ImageStats, ImportResult, ViewType } from '../../types'; // 类型定义

/**
 * @component Sidebar
 * @description 侧边栏组件 - 提供应用导航、图片统计、导入功能、模型列表和设置面板
 */
interface SidebarProps {
  activeView: ViewType; // 当前激活的视图
  onNavigate: (view: ViewType) => void; // 视图切换回调
  stats: ImageStats | null; // 图片统计数据
  onImport: () => void; // 导入PNG回调
  onImportFolder: () => void; // 导入文件夹回调
  importResult: ImportResult | null; // 导入结果
  importProgress: { done: number; total: number } | null; // 后台导入进度
}

export function Sidebar({
  activeView, onNavigate, stats, onImport, onImportFolder, importResult, importProgress,
}: SidebarProps) {
  const { t, locale, toggleLocale } = useI18n(); // t: 翻译函数, locale: 当前语言, toggleLocale: 切换语言
  const [showSettings, setShowSettings] = useState(false); // 设置面板展开状态
  const [storageConfig, setStorageConfig] = useState<{ storage_dir: string | null; resolved_dir: string } | null>(null); // 存储配置
  const [customDir, setCustomDir] = useState(''); // 自定义目录输入

  /**
   * 加载存储配置
   */
  useEffect(() => {
    api.getStorageConfig().then(cfg => {
      setStorageConfig(cfg);
      setCustomDir(cfg.storage_dir || '');
    }).catch(() => {});
  }, []);

  /**
   * 保存自定义存储目录
   */
  const handleSaveStorageDir = async () => {
    try {
      const cfg = await api.setStorageDir(customDir.trim() || null);
      setStorageConfig(cfg);
    } catch (e) {
      console.error('Failed to save storage dir:', e);
    }
  };

  return (
    <aside className="w-64 min-w-[256px] h-screen flex flex-col bg-ink-bg border-r border-ink-line p-5 gap-6 overflow-y-auto">
      {/* 应用标题 */}
      <div>
        <h1 className="font-display text-display-md text-ink tracking-tight">
          {t.app.title}
        </h1>
        {stats && (
          <div className="flex gap-4 mt-1.5 text-caption text-ink-muted uppercase tracking-widest">
            <span>{stats.total_images} {t.gallery.images}</span>
          </div>
        )}
      </div>

      {/* 导入按钮区域 */}
      <div className="flex flex-col gap-2">
        <Button variant="primary" onClick={onImport}>
          {t.import.importPngs}
        </Button>
        <Button variant="secondary" size="sm" onClick={onImportFolder}>
          {t.import.importFolder}
        </Button>
        {importProgress && (
          <Card padding="sm" bordered className="mt-2">
            <p className="text-xs text-ink-muted">
              Importing {importProgress.total > 0 ? `${importProgress.done}/${importProgress.total}` : '...'}
            </p>
            {importProgress.total > 0 && (
              <div className="mt-2 h-1 bg-ink-line rounded-full overflow-hidden">
                <div
                  className="h-full bg-ink transition-all duration-200"
                  style={{ width: `${Math.round((importProgress.done / importProgress.total) * 100)}%` }}
                />
              </div>
            )}
          </Card>
        )}
        {/* 导入结果提示 */}
        {importResult && (
          <Card padding="sm" bordered className="mt-2">
            <p className="text-xs text-ink-muted">
              {t.import.success}: {importResult.success.length}, {t.import.skipped}: {importResult.skipped.length}, {t.import.errors}: {importResult.errors.length}
            </p>
          </Card>
        )}
      </div>

      {/* 导航菜单 */}
      <nav className="flex flex-col gap-1">
        {(['gallery', 'favorites'] as const).map(v => (
          <button
            key={v}
            onClick={() => onNavigate(v)}
            className={`text-left px-3 py-2 text-sm rounded-btn transition-colors duration-150 ${
              activeView === v
                ? 'bg-ink text-white font-medium' // 当前激活样式
                : 'text-ink-secondary hover:text-ink hover:bg-ink-surface'
            }`}
          >
            {v === 'gallery' ? t.nav.gallery : t.nav.favorites}
          </button>
        ))}
      </nav>

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

      <div className="flex-1" /> {/* 弹性空间，将设置推到底部 */}

      {/* 设置区域 */}
      <div className="flex flex-col gap-2">
        <button
          className="flex items-center justify-between text-caption text-ink-muted hover:text-ink transition-colors uppercase tracking-widest"
          onClick={() => setShowSettings(!showSettings)}
        >
          <span>{t.nav.settings}</span>
          <svg
            width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            className={`transition-transform duration-200 ${showSettings ? 'rotate-180' : ''}`}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {showSettings && storageConfig && (
          <Card padding="sm" bordered className="space-y-3">
            {/* 语言切换 */}
            <div>
              <label className="text-[10px] text-ink-muted uppercase tracking-widest">Language</label>
              <button
                onClick={toggleLocale}
                className="mt-1 w-full px-3 py-2 text-left text-xs rounded-btn border border-ink-line text-ink-secondary hover:text-ink hover:border-ink-muted transition-colors"
              >
                {locale === 'en' ? '中文' : 'English'}
              </button>
            </div>
            {/* 当前存储路径 */}
            <div>
              <label className="text-[10px] text-ink-muted uppercase tracking-widest">{t.sidebar.storagePath}</label>
              <p className="text-xs text-ink-secondary mt-1 break-all" title={storageConfig.resolved_dir}>
                {storageConfig.resolved_dir}
              </p>
            </div>
            {/* 自定义存储目录 */}
            <div>
              <label className="text-[10px] text-ink-muted uppercase tracking-widest">{t.sidebar.customDir}</label>
              <div className="flex gap-1 mt-1">
                <Input
                  placeholder={t.sidebar.customDirPlaceholder}
                  value={customDir}
                  onChange={e => setCustomDir(e.target.value)}
                  className="!py-1 !text-xs flex-1"
                />
                <Button size="sm" variant="secondary" onClick={handleSaveStorageDir}>
                  {t.sidebar.saveStorage}
                </Button>
              </div>
            </div>
          </Card>
        )}
      </div>
    </aside>
  );
}
