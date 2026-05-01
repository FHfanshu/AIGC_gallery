import { useState, useEffect, useRef } from 'react'; // useState: 本地状态, useEffect: 副作用, useRef: DOM引用
import { Button, Card, Input } from '../ui'; // UI组件: 按钮、卡片、输入框
import { truncate } from '../../lib/utils'; // 字符串截断工具
import { api } from '../../lib/tauri'; // Tauri IPC API封装
import { useI18n } from '../../i18n'; // 国际化Hook
import type { CivitaiBaseUrl, ImageStats, ImportResult, ImportStrategy, StorageConfig, ViewType } from '../../types'; // 类型定义

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
  const [storageConfig, setStorageConfig] = useState<StorageConfig | null>(null); // 存储配置
  const [customDir, setCustomDir] = useState(''); // 自定义目录输入
  const [importStrategy, setImportStrategy] = useState<ImportStrategy>('copy');
  const [civitaiBaseUrl, setCivitaiBaseUrl] = useState<CivitaiBaseUrl>('https://civitai.com');
  const [civitaiKey, setCivitaiKey] = useState('');
  const [hasCivitaiKey, setHasCivitaiKey] = useState(false);

  /**
   * 加载存储配置
   */
  useEffect(() => {
    api.getStorageConfig().then(cfg => {
      setStorageConfig(cfg);
      setCustomDir(cfg.storage_dir || '');
      setImportStrategy(cfg.import_strategy);
      setCivitaiBaseUrl(cfg.civitai_base_url);
    }).catch(() => {});
    api.getCivitaiKeyStatus().then(status => {
      setHasCivitaiKey(status.has_key);
    }).catch(() => {});
  }, []);

  /**
   * 保存自定义存储目录
   */
  const handleSaveStorageDir = async () => {
    try {
      const cfg = await api.setStorageDir(customDir.trim() || null, importStrategy, civitaiBaseUrl);
      setStorageConfig(cfg);
    } catch (e) {
      console.error('Failed to save storage dir:', e);
    }
  };

  const handleSaveCivitaiKey = async () => {
    try {
      const status = await api.setCivitaiApiKey(civitaiKey);
      setHasCivitaiKey(status.has_key);
      setCivitaiKey('');
    } catch (e) {
      console.error('Failed to save Civitai key:', e);
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
            <p className="text-sm font-medium text-ink">
              {t.import.importing} {importProgress.total > 0 ? `${importProgress.done}/${importProgress.total}` : '...'}
            </p>
            {importProgress.total > 0 && (
              <div className="mt-2.5 h-2 bg-ink-line rounded-full overflow-hidden">
                <div
                  className="h-full bg-ink-success rounded-full transition-all duration-200"
                  style={{ width: `${Math.round((importProgress.done / importProgress.total) * 100)}%` }}
                />
              </div>
            )}
          </Card>
        )}
        {/* 导入结果提示 */}
        {importResult && (
          <Card padding="sm" bordered className="mt-2">
            <p className="text-sm font-medium text-ink">
              {t.import.success}: <span className="text-ink-success">{importResult.success.length}</span>{' '}
              {t.import.skipped}: {importResult.skipped.length}{' '}
              {importResult.errors.length > 0 && (
                <>{t.import.errors}: <span className="text-ink-danger">{importResult.errors.length}</span></>
              )}
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
          className="flex items-center gap-2 w-full px-3 py-2 text-sm text-ink-secondary hover:text-ink hover:bg-ink-surface rounded-btn transition-colors"
          onClick={() => setShowSettings(!showSettings)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          <span className="font-medium">{t.nav.settings}</span>
          <svg
            width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            className={`ml-auto transition-transform duration-200 ${showSettings ? 'rotate-180' : ''}`}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {showSettings && storageConfig && (
          <Card padding="sm" bordered className="space-y-3 motion-fade-in">
            {/* 语言切换 */}
            <div>
              <label className="text-xs font-medium text-ink-secondary uppercase tracking-widest">{t.sidebar.language}</label>
              <button
                onClick={toggleLocale}
                className="mt-1 w-full px-3 py-2 text-left text-xs rounded-btn border border-ink-line text-ink-secondary hover:text-ink hover:border-ink-muted transition-colors"
              >
                {locale === 'en' ? '中文' : 'English'}
              </button>
            </div>
            {/* 导入策略 */}
            <div>
              <label className="text-xs font-medium text-ink-secondary uppercase tracking-widest">{t.sidebar.importStrategy}</label>
              <select
                value={importStrategy}
                onChange={e => setImportStrategy(e.target.value as ImportStrategy)}
                className="mt-1 w-full px-3 py-2 text-xs rounded-btn border border-ink-line bg-ink-bg text-ink-secondary outline-none focus:border-ink-muted"
              >
                <option value="copy">{t.sidebar.managedCopy}</option>
                <option value="hardlink_then_copy">{t.sidebar.hardLink}</option>
              </select>
              <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                {importStrategy === 'copy'
                  ? t.sidebar.managedCopyDesc
                  : t.sidebar.hardLinkDesc}
              </p>
            </div>
            {/* Civitai API */}
            <div>
              <label className="text-xs font-medium text-ink-secondary uppercase tracking-widest">{t.sidebar.civitaiBaseUrl}</label>
              <select
                value={civitaiBaseUrl}
                onChange={e => setCivitaiBaseUrl(e.target.value as CivitaiBaseUrl)}
                className="mt-1 w-full px-3 py-2 text-xs rounded-btn border border-ink-line bg-ink-bg text-ink-secondary outline-none focus:border-ink-muted"
              >
                <option value="https://civitai.com">civitai.com</option>
                <option value="https://civitai.green">civitai.green</option>
                <option value="https://civitai.red">civitai.red</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-ink-secondary uppercase tracking-widest">{t.sidebar.civitaiApiKey}</label>
              <p className="mt-1 text-xs text-ink-muted">
                {hasCivitaiKey ? t.sidebar.apiKeyStored : t.sidebar.apiKeyStored}
              </p>
              <div className="flex gap-1 mt-1">
                <Input
                  type="password"
                  placeholder={hasCivitaiKey ? t.sidebar.apiKeyClearHint : t.sidebar.apiKeyPlaceholder}
                  value={civitaiKey}
                  onChange={e => setCivitaiKey(e.target.value)}
                  className="!py-1 !text-xs flex-1"
                />
                <Button size="sm" variant="secondary" onClick={handleSaveCivitaiKey}>
                  {t.common.save}
                </Button>
              </div>
            </div>
            {/* 当前存储路径 */}
            <div>
              <label className="text-xs font-medium text-ink-secondary uppercase tracking-widest">{t.sidebar.storagePath}</label>
              <p className="text-xs text-ink-secondary mt-1 break-all" title={storageConfig.resolved_dir}>
                {storageConfig.resolved_dir}
              </p>
            </div>
            {/* 自定义存储目录 */}
            <div>
              <label className="text-xs font-medium text-ink-secondary uppercase tracking-widest">{t.sidebar.customDir}</label>
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
            {/* 数据导入导出 */}
            <div>
              <label className="text-xs font-medium text-ink-secondary uppercase tracking-widest">{t.sidebar.dataBackup}</label>
              <div className="flex gap-2 mt-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={async () => {
                    try {
                      const { save } = await import('@tauri-apps/plugin-dialog');
                      const path = await save({
                        defaultPath: 'aigc-gallery-backup.zip',
                        filters: [{ name: 'ZIP', extensions: ['zip'] }],
                      });
                      if (!path) return;
                      const result = await api.exportGallery(path);
                      alert(result);
                    } catch (e) {
                      console.error('Export failed:', e);
                      alert(`导出失败: ${e}`);
                    }
                  }}
                >
                  {t.sidebar.exportData}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={async () => {
                    try {
                      const { open } = await import('@tauri-apps/plugin-dialog');
                      const path = await open({
                        filters: [{ name: 'ZIP', extensions: ['zip'] }],
                        multiple: false,
                      });
                      if (!path) return;
                      if (!confirm(t.sidebar.importConfirm)) return;
                      const result = await api.importGallery(path as string);
                      alert(result);
                      window.location.reload();
                    } catch (e) {
                      console.error('Import failed:', e);
                      alert(`导入失败: ${e}`);
                    }
                  }}
                >
                  {t.sidebar.importData}
                </Button>
              </div>
            </div>
          </Card>
        )}
      </div>
    </aside>
  );
}
