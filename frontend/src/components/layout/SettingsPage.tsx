import { useEffect, useState, useCallback, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { confirm } from '@tauri-apps/plugin-dialog';
import { Button, Card, Input } from '../ui';
import { api } from '../../lib/tauri';
import { useI18n, tReplace } from '../../i18n';
import type { BackupProgress, BackupResult, CivitaiBaseUrl, ImportStrategy, StorageConfig, ThemeMode } from '../../types';

interface SettingsPageProps {
  open: boolean;
  onClose: () => void;
  themeMode: ThemeMode;
  onThemeModeChange: (mode: ThemeMode) => void;
  backupProgress: BackupProgress | null;
  backupResult: BackupResult | null;
  onBackupProgressReset: () => void;
}

/** 设置页：集中管理语言、存储、外部 API 与数据备份，避免 Sidebar 承载过多全局配置。 */
export function SettingsPage({ open, onClose, themeMode, onThemeModeChange, backupProgress, backupResult, onBackupProgressReset }: SettingsPageProps) {
  const { t, locale, setLocale } = useI18n();
  const [storageConfig, setStorageConfig] = useState<StorageConfig | null>(null);
  const [customDir, setCustomDir] = useState('');
  const [importStrategy, setImportStrategy] = useState<ImportStrategy>('copy');
  const [civitaiBaseUrl, setCivitaiBaseUrl] = useState<CivitaiBaseUrl>('https://civitai.com');
  const [civitaiKey, setCivitaiKey] = useState('');
  const [hasCivitaiKey, setHasCivitaiKey] = useState(false);
  const [aiTagBaseUrl, setAiTagBaseUrl] = useState('https://api.example.com/v1');
  const [aiTagModel, setAiTagModel] = useState('gemini-3-flash');
  const [aiTagKey, setAiTagKey] = useState('');
  const [hasAiTagKey, setHasAiTagKey] = useState(false);

  // AI 打标进度状态
  const [aiTagProgress, setAiTagProgress] = useState<{ done: number; total: number } | null>(null);
  const [aiTagResult, setAiTagResult] = useState<{ success: number; errors: number; total: number } | null>(null);
  const [aiTagError, setAiTagError] = useState<string | null>(null);

  const backupPercent = backupProgress && backupProgress.total_bytes > 0
    ? Math.min(100, Math.round((backupProgress.bytes_done / backupProgress.total_bytes) * 100))
    : backupProgress && backupProgress.total > 0
      ? Math.min(100, Math.round((backupProgress.done / backupProgress.total) * 100))
      : 0;

  useEffect(() => {
    if (!open) return;
    api.getStorageConfig().then(cfg => {
      setStorageConfig(cfg);
      setCustomDir(cfg.storage_dir || '');
      setImportStrategy(cfg.import_strategy);
      setCivitaiBaseUrl(cfg.civitai_base_url);
      setAiTagBaseUrl(cfg.ai_tag_base_url);
      setAiTagModel(cfg.ai_tag_model);
    }).catch(() => {});
    api.getCivitaiKeyStatus().then(status => setHasCivitaiKey(status.has_key)).catch(() => {});
    api.getAiTagKeyStatus().then(status => setHasAiTagKey(status.has_key)).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, open]);

  const handleSaveStorageDir = async () => {
    try {
      const cfg = await api.setStorageDir(customDir.trim() || null, importStrategy, civitaiBaseUrl, aiTagBaseUrl, aiTagModel);
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

  // 监听 AI 打标进度事件
  const unlistenProgress = useRef<(() => void) | null>(null);
  const unlistenFinished = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!open) return;
    // 重置状态
    setAiTagProgress(null);
    setAiTagResult(null);
    setAiTagError(null);

    const setup = async () => {
      unlistenProgress.current = await listen<{ done: number; total: number }>('ai-tagging-progress', (event) => {
        setAiTagProgress({ done: event.payload.done, total: event.payload.total });
        setAiTagError(null);
      });
      unlistenFinished.current = await listen<{ total: number; success: number; errors: number }>('ai-tagging-finished', (event) => {
        setAiTagResult(event.payload);
        setAiTagProgress(null);
      });
    };
    setup();

    return () => {
      unlistenProgress.current?.();
      unlistenFinished.current?.();
    };
  }, [open]);

  const handleStartAiTagging = useCallback(async () => {
    try {
      setAiTagError(null);
      setAiTagResult(null);
      await api.startAiTaggingMissingImages();
    } catch (e) {
      setAiTagError(String(e));
    }
  }, []);

  const handleSaveAiTag = async () => {
    try {
      const cfg = await api.setAiTagConfig(aiTagBaseUrl, aiTagModel);
      setAiTagBaseUrl(cfg.base_url);
      setAiTagModel(cfg.model);
      const status = await api.setAiTagApiKey(aiTagKey);
      setHasAiTagKey(status.has_key);
      setAiTagKey('');
    } catch (e) {
      console.error('Failed to save AI tag settings:', e);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] bg-ink-bg/70 backdrop-blur-sm flex justify-end motion-fade-in" onMouseDown={onClose}>
      <section
        className="w-[520px] max-w-[calc(100vw-32px)] h-screen bg-ink-bg border-l border-ink-line shadow-2xl overflow-y-auto"
        onMouseDown={event => event.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-5 bg-ink-bg/95 backdrop-blur border-b border-ink-line">
          <div>
            <h2 className="font-display font-bold text-lg text-ink">{t.nav.settings}</h2>
            <p className="mt-1 text-xs text-ink-muted">{t.sidebar.settingsSubtitle}</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-ink-faint hover:text-ink hover:bg-ink-surface transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-5">
          <Card padding="md" bordered className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-ink">{t.sidebar.theme}</h3>
              <p className="mt-1 text-xs text-ink-muted">{t.sidebar.themeDesc}</p>
            </div>
            <div className="grid grid-cols-3 gap-1 rounded-btn border border-ink-line bg-ink-surface/60 p-1">
              {([
                ['system', t.sidebar.themeSystem],
                ['light', t.sidebar.themeLight],
                ['dark', t.sidebar.themeDark],
              ] as const).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => onThemeModeChange(mode)}
                  className={`px-3 py-2 text-xs rounded-btn transition-colors ${
                    themeMode === mode
                      ? 'bg-ink text-ink-bg font-medium'
                      : 'text-ink-muted hover:text-ink hover:bg-ink-bg'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </Card>

          <Card padding="md" bordered className="space-y-4">
            <h3 className="text-sm font-semibold text-ink">{t.sidebar.general}</h3>
            <div>
              <label className="text-xs font-medium text-ink-secondary uppercase tracking-widest">{t.sidebar.language}</label>
              <select
                value={locale}
                onChange={e => setLocale(e.target.value as 'en' | 'zh')}
                className="mt-1 w-full px-3 py-2 text-xs rounded-btn border border-ink-line bg-ink-bg text-ink-secondary outline-none focus:border-ink-muted"
              >
                <option value="zh">简体中文</option>
                <option value="en">English</option>
              </select>
            </div>
          </Card>

          <Card padding="md" bordered className="space-y-4">
            <h3 className="text-sm font-semibold text-ink">{t.sidebar.galleryStorage}</h3>
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
                {importStrategy === 'copy' ? t.sidebar.managedCopyDesc : t.sidebar.hardLinkDesc}
              </p>
            </div>
            <div>
              <label className="text-xs font-medium text-ink-secondary uppercase tracking-widest">{t.sidebar.storagePath}</label>
              <p className="text-xs text-ink-secondary mt-1 break-all" title={storageConfig?.resolved_dir}>
                {storageConfig?.resolved_dir || '-'}
              </p>
            </div>
            <div>
              <label className="text-xs font-medium text-ink-secondary uppercase tracking-widest">{t.sidebar.customDir}</label>
              <div className="flex gap-2 mt-1">
                <Input
                  placeholder={t.sidebar.customDirPlaceholder}
                  value={customDir}
                  onChange={e => setCustomDir(e.target.value)}
                  className="!py-1.5 !text-xs flex-1"
                />
                <Button size="sm" variant="secondary" onClick={handleSaveStorageDir}>
                  {t.sidebar.saveStorage}
                </Button>
              </div>
            </div>
          </Card>

          <Card padding="md" bordered className="space-y-4">
            <h3 className="text-sm font-semibold text-ink">Civitai</h3>
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
              {hasCivitaiKey && <p className="mt-1 text-xs text-ink-muted">{t.sidebar.apiKeyStored}</p>}
              <div className="flex gap-2 mt-1">
                <Input
                  type="password"
                  placeholder={hasCivitaiKey ? t.sidebar.apiKeyClearHint : t.sidebar.apiKeyPlaceholder}
                  value={civitaiKey}
                  onChange={e => setCivitaiKey(e.target.value)}
                  className="!py-1.5 !text-xs flex-1"
                />
                <Button size="sm" variant="secondary" onClick={handleSaveCivitaiKey}>
                  {t.common.save}
                </Button>
              </div>
            </div>
          </Card>

          <Card padding="md" bordered className="space-y-4">
            <h3 className="text-sm font-semibold text-ink">{t.sidebar.aiTagTitle}</h3>
            <p className="text-xs leading-relaxed text-ink-muted">
              {t.sidebar.aiTagDesc}
            </p>
            <Input value={aiTagBaseUrl} onChange={e => setAiTagBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" className="!py-1.5 !text-xs" />
            <Input value={aiTagModel} onChange={e => setAiTagModel(e.target.value)} placeholder="gpt-4o-mini" className="!py-1.5 !text-xs" />
            {hasAiTagKey && <p className="mt-1 text-xs text-ink-muted">{t.sidebar.aiTagApiKeySaved}</p>}
            <Input type="password" value={aiTagKey} onChange={e => setAiTagKey(e.target.value)} placeholder={hasAiTagKey ? t.sidebar.aiTagApiKeyHint : t.sidebar.aiTagApiKeyPlaceholder} className="!py-1.5 !text-xs" />
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={handleSaveAiTag}>{t.common.save}</Button>
              <Button
                size="sm"
                variant="primary"
                disabled={!!aiTagProgress}
                onClick={handleStartAiTagging}
              >
                {aiTagProgress ? tReplace(t.sidebar.aiTagProgress, { done: aiTagProgress.done, total: aiTagProgress.total }) : t.sidebar.aiTagTagMissing}
              </Button>
            </div>
            {/* 打标进度条 */}
            {aiTagProgress && (
              <div className="rounded-btn border border-ink-line bg-ink-surface p-2">
                <div className="h-2 bg-ink-line rounded-full overflow-hidden">
                  <div
                    className="h-full bg-ink rounded-full transition-all duration-200"
                    style={{ width: `${aiTagProgress.total > 0 ? Math.round((aiTagProgress.done / aiTagProgress.total) * 100) : 0}%` }}
                  />
                </div>
                <p className="mt-1 text-[10px] text-ink-muted text-center">
                  {tReplace(t.sidebar.aiTagProgress, { done: aiTagProgress.done, total: aiTagProgress.total })}
                </p>
              </div>
            )}
            {/* 打标完成结果 */}
            {aiTagResult && (
              <div className={`rounded-btn border p-2 text-xs ${aiTagResult.errors > 0 ? 'border-yellow-300 text-yellow-700 bg-yellow-50' : 'border-ink-line text-ink-secondary bg-ink-surface'}`}>
                {tReplace(t.sidebar.aiTagComplete, { success: aiTagResult.success, total: aiTagResult.total, errors: aiTagResult.errors })}
              </div>
            )}
            {/* 打标错误提示 */}
            {aiTagError && (
              <div className="rounded-btn border border-red-200 text-red-600 bg-red-50 p-2 text-xs">
                {aiTagError}
              </div>
            )}
          </Card>

          <Card padding="md" bordered className="space-y-4">
            <h3 className="text-sm font-semibold text-ink">{t.sidebar.dataBackup}</h3>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={!!backupProgress}
                onClick={async () => {
                  try {
                    const { save } = await import('@tauri-apps/plugin-dialog');
                    const path = await save({
                      defaultPath: 'aigc-gallery-backup.zip',
                      filters: [{ name: 'ZIP', extensions: ['zip'] }],
                    });
                    if (!path) return;
                    onBackupProgressReset();
                    await api.startExportGallery(path);
                  } catch (e) {
                    console.error('Export failed:', e);
                    alert(tReplace(t.sidebar.exportFailed, { error: String(e) }));
                  }
                }}
              >
                {t.sidebar.exportData}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={!!backupProgress}
                onClick={async () => {
                  try {
                    const { open } = await import('@tauri-apps/plugin-dialog');
                    const path = await open({ filters: [{ name: 'ZIP', extensions: ['zip'] }], multiple: false });
                    if (!path) return;
                    if (!(await confirm(t.sidebar.importConfirm))) return;
                    onBackupProgressReset();
                    await api.startImportGallery(path as string);
                  } catch (e) {
                    console.error('Import failed:', e);
                    alert(tReplace(t.sidebar.importFailed, { error: String(e) }));
                  }
                }}
              >
                {t.sidebar.importData}
              </Button>
            </div>
            {backupProgress && (
              <div className="rounded-btn border border-ink-line bg-ink-surface p-2">
                <div className="flex items-center justify-between text-xs text-ink-secondary">
                  <span>{backupProgress.current || t.sidebar.backupWorking}</span>
                  <span>{backupProgress.total > 0 ? `${backupProgress.done}/${backupProgress.total}` : `${backupPercent}%`}</span>
                </div>
                <div className="mt-2 h-2 bg-ink-line rounded-full overflow-hidden">
                  <div className="h-full bg-ink-success rounded-full transition-all duration-200" style={{ width: `${backupPercent}%` }} />
                </div>
              </div>
            )}
            {backupResult && (
              <div className={`rounded-btn border p-2 text-xs ${backupResult.success ? 'border-ink-line text-ink-secondary bg-ink-surface' : 'border-red-200 text-ink-danger bg-red-50'}`}>
                {backupResult.message}
              </div>
            )}
          </Card>
        </div>
      </section>
    </div>
  );
}
