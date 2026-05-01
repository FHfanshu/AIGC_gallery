import { useState, useEffect } from 'react';
import { NeuButton, NeuCard, NeuInput, NeuTag } from '../ui';
import { truncate } from '../../lib/utils';
import { api } from '../../lib/tauri';
import { useI18n } from '../../i18n';
import type { ImageStats, TagRecord, ImportResult } from '../../types';
import type { ViewType } from '../../types';

interface SidebarProps {
  activeView: ViewType;
  onNavigate: (view: ViewType) => void;
  tags: TagRecord[];
  stats: ImageStats | null;
  onImport: () => void;
  onImportFolder: () => void;
  onAddTag: (name: string, color?: string) => void;
  onRemoveTag: (tagId: number) => void;
  selectedTag: string | null;
  onSelectTag: (tagName: string | null) => void;
  importResult: ImportResult | null;
}

export function Sidebar({
  activeView,
  onNavigate,
  tags,
  stats,
  onImport,
  onImportFolder,
  onAddTag,
  onRemoveTag,
  selectedTag,
  onSelectTag,
  importResult,
}: SidebarProps) {
  const { t, locale, toggleLocale } = useI18n();
  const [showTagInput, setShowTagInput] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [storageConfig, setStorageConfig] = useState<{ storage_dir: string | null; resolved_dir: string } | null>(null);
  const [customDir, setCustomDir] = useState('');

  useEffect(() => {
    api.getStorageConfig().then(cfg => {
      setStorageConfig(cfg);
      setCustomDir(cfg.storage_dir || '');
    }).catch(() => {});
  }, []);

  const handleSaveStorageDir = async () => {
    try {
      const cfg = await api.setStorageDir(customDir.trim() || null);
      setStorageConfig(cfg);
    } catch (e) {
      console.error('Failed to save storage dir:', e);
    }
  };

  const handleAddTag = () => {
    const name = newTagName.trim();
    if (!name) return;
    onAddTag(name);
    setNewTagName('');
    setShowTagInput(false);
  };

  return (
    <aside className="w-72 min-w-[288px] h-screen flex flex-col bg-neu-bg p-5 gap-5 overflow-y-auto">
      {/* App Title */}
      <div>
        <h1 className="font-display font-extrabold text-2xl text-neu-text tracking-tight">
          {t.app.title}
        </h1>
        {stats && (
          <div className="flex gap-4 mt-2 text-sm text-neu-muted">
            <span>{stats.total_images} {t.gallery.images}</span>
            <span>{stats.total_tags} {t.gallery.tags}</span>
          </div>
        )}
      </div>

      {/* Import Buttons */}
      <div className="flex flex-col gap-2">
        <NeuButton variant="primary" onClick={onImport}>
          {t.import.importPngs}
        </NeuButton>
        <NeuButton variant="secondary" size="sm" onClick={onImportFolder}>
          {t.import.importFolder}
        </NeuButton>
        {importResult && (
          <NeuCard padding="sm" className="!rounded-neu-sm mt-2">
            <p className="text-xs text-neu-muted">
              {t.import.success}: {importResult.success.length}, {t.import.skipped}: {importResult.skipped.length}, {t.import.errors}: {importResult.errors.length}
            </p>
          </NeuCard>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex flex-col gap-2">
        <NeuButton
          variant={activeView === 'gallery' && !selectedTag ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => { onNavigate('gallery'); onSelectTag(null); }}
          className={activeView === 'gallery' && !selectedTag ? 'neu-inset-sm !bg-neu-accent/10 !text-neu-accent' : ''}
        >
          {t.nav.gallery}
        </NeuButton>
        <NeuButton
          variant={activeView === 'favorites' ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => onNavigate('favorites')}
          className={activeView === 'favorites' ? 'neu-inset-sm !bg-neu-accent/10 !text-neu-accent' : ''}
        >
          {t.nav.favorites}
        </NeuButton>
      </nav>

      {/* Tags Section */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="font-display font-semibold text-sm text-neu-text uppercase tracking-wider">{t.sidebar.tags}</h3>
          <NeuButton
            variant="icon"
            size="sm"
            onClick={() => setShowTagInput(!showTagInput)}
          >
            +
          </NeuButton>
        </div>

        {showTagInput && (
          <div className="flex gap-2">
            <NeuInput
              placeholder={t.sidebar.tagPlaceholder}
              value={newTagName}
              onChange={e => setNewTagName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddTag()}
              className="!py-2 !text-sm"
              autoFocus
            />
            <NeuButton size="sm" onClick={handleAddTag}>{t.sidebar.add}</NeuButton>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <NeuTag
            name={t.sidebar.all}
            active={selectedTag === null}
            onToggle={() => onSelectTag(null)}
          />
          {tags.map(tag => (
            <NeuTag
              key={tag.id}
              name={tag.name}
              color={tag.color}
              active={selectedTag === tag.name}
              count={tag.count}
              onToggle={() => onSelectTag(selectedTag === tag.name ? null : tag.name)}
              onRemove={() => onRemoveTag(tag.id)}
            />
          ))}
        </div>
      </div>

      {/* Models Section */}
      {stats && stats.models.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="font-display font-semibold text-sm text-neu-text uppercase tracking-wider">{t.sidebar.models}</h3>
          <div className="flex flex-col gap-1.5">
            {stats.models.map(m => (
              <div key={m.model} className="flex items-center justify-between px-3 py-1.5 rounded-neu-sm text-sm">
                <span className="text-neu-muted truncate mr-2" title={m.model}>
                  {truncate(m.model, 22)}
                </span>
                <span className="text-xs text-neu-muted opacity-60 flex-shrink-0">{m.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Language Toggle */}
      <NeuButton variant="secondary" size="sm" onClick={toggleLocale}>
        {locale === 'en' ? '中文' : 'English'}
      </NeuButton>

      {/* Settings Section */}
      <div className="flex flex-col gap-2">
        <button
          className="flex items-center justify-between text-sm text-neu-muted hover:text-neu-text transition-colors"
          onClick={() => setShowSettings(!showSettings)}
        >
          <span className="font-display font-semibold uppercase tracking-wider">{t.nav.settings}</span>
          <svg
            width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            className={`transition-transform duration-300 ${showSettings ? 'rotate-180' : ''}`}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {showSettings && storageConfig && (
          <NeuCard padding="sm" className="!rounded-neu-sm space-y-3">
            <div>
              <label className="text-[10px] text-neu-muted uppercase tracking-wider">{t.sidebar.storagePath}</label>
              <p className="text-xs text-neu-text mt-1 break-all" title={storageConfig.resolved_dir}>
                {storageConfig.resolved_dir}
              </p>
            </div>
            <div>
              <label className="text-[10px] text-neu-muted uppercase tracking-wider">{t.sidebar.customDir}</label>
              <div className="flex gap-1 mt-1">
                <NeuInput
                  placeholder={t.sidebar.customDirPlaceholder}
                  value={customDir}
                  onChange={e => setCustomDir(e.target.value)}
                  className="!py-1.5 !text-xs flex-1"
                />
                <NeuButton size="sm" variant="secondary" onClick={handleSaveStorageDir}>
                  {t.sidebar.saveStorage}
                </NeuButton>
              </div>
            </div>
          </NeuCard>
        )}
      </div>
    </aside>
  );
}
