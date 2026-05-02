// 应用根组件
// 负责视图路由（画廊/收藏）、图片导入、拖拽上传、事件编排
// 组合 Sidebar + Header + GalleryGrid + ImageDetail 四大布局区域

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { Sidebar } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { SettingsPage } from './components/layout/SettingsPage';
import { GalleryGrid, type GalleryDensity } from './components/gallery/GalleryGrid';
import { ImageDetail } from './components/gallery/ImageDetail';
import { useGallery, useFavorites, useStats, useNSFWFilter } from './hooks';
import { api } from './lib/tauri';
import { useI18n } from './i18n';
import type { AiTagFinished, AiTagProgress, BackupProgress, BackupResult, ImageRecord, ImportProgress, ImportResult, ViewType } from './types';

function App() {
  // 当前视图：gallery（画廊）/ favorites（收藏）
  const [view, setView] = useState<ViewType>('gallery');
  // 当前选中查看详情的图片
  const [selectedImage, setSelectedImage] = useState<ImageRecord | null>(null);
  // 导入结果提示（成功/跳过/错误数量）
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  // 导入进度：后端通过事件推送 { done, total }
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [backupProgress, setBackupProgress] = useState<BackupProgress | null>(null);
  const [backupResult, setBackupResult] = useState<BackupResult | null>(null);
  const [reparseProgress, setReparseProgress] = useState<{ done: number; total: number } | null>(null);
  const [aiTagProgress, setAiTagProgress] = useState<AiTagProgress | null>(null);
  const [aiTagResult, setAiTagResult] = useState<AiTagFinished | null>(null);
  // 拖拽文件悬停状态（用于显示全屏遮罩）
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false); // 顶部刷新按钮反馈状态
  const [scrollToImageId, setScrollToImageId] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [galleryDensity, setGalleryDensity] = useState<GalleryDensity>(() => {
    const saved = localStorage.getItem('aigc-gallery-density');
    return saved === 'small' || saved === 'large' ? saved : 'medium';
  });

  const nsfw = useNSFWFilter();
  const gallery = useGallery();
  const favorites = useFavorites();
  const stats = useStats();
  const { t } = useI18n();
  const dropCleanupRef = useRef<(() => void) | null>(null);
  const handleDropFilesRef = useRef<(files: string[]) => void>(() => {});

  const supportedImageExtensions = ['.png', '.jpg', '.jpeg', '.webp'];

  useEffect(() => {
    localStorage.setItem('aigc-gallery-density', galleryDensity);
  }, [galleryDensity]);

  // 监听后端推送的导入进度和完成事件
  useEffect(() => {
    const unlisteners: Array<() => void> = [];
    // 导入进度更新：显示已完成/总数
    listen<ImportProgress>('import-progress', event => {
      setImportProgress(event.payload.finished ? null : event.payload);
    }).then(unlisten => unlisteners.push(unlisten));
    // 导入完成：清除进度，显示结果，5 秒后自动关闭
    listen<ImportResult>('import-finished', event => {
      setImportProgress(null);
      setImportResult(event.payload);
      setTimeout(() => setImportResult(null), 5000);
      if (event.payload.success.length > 0) {
        // 有新图片导入成功，刷新列表和统计
        gallery.loadImages(true);
        stats.loadStats();
      }
    }).then(unlisten => unlisteners.push(unlisten));
    listen<BackupProgress>('export-progress', event => {
      setBackupProgress(event.payload.finished ? null : event.payload);
    }).then(unlisten => unlisteners.push(unlisten));
    listen<BackupResult>('export-finished', event => {
      setBackupProgress(null);
      setBackupResult(event.payload);
      setTimeout(() => setBackupResult(null), 8000);
    }).then(unlisten => unlisteners.push(unlisten));
    listen<BackupProgress>('backup-import-progress', event => {
      setBackupProgress(event.payload.finished ? null : event.payload);
    }).then(unlisten => unlisteners.push(unlisten));
    listen<BackupResult>('backup-import-finished', event => {
      setBackupProgress(null);
      setBackupResult(event.payload);
      setTimeout(() => setBackupResult(null), 8000);
      if (event.payload.success) {
        gallery.loadImages(true);
        favorites.loadFavorites();
        stats.loadStats();
      }
    }).then(unlisten => unlisteners.push(unlisten));
    listen<{ done: number; total: number }>('reparse-progress', event => {
      setReparseProgress({ done: event.payload.done, total: event.payload.total });
    }).then(unlisten => unlisteners.push(unlisten));
    listen<AiTagProgress>('ai-tagging-progress', event => {
      setAiTagProgress(event.payload.finished ? null : event.payload);
    }).then(unlisten => unlisteners.push(unlisten));
    listen<AiTagFinished>('ai-tagging-finished', event => {
      setAiTagProgress(null);
      setAiTagResult(event.payload);
      setTimeout(() => setAiTagResult(null), 8000);
      gallery.loadImages(true);
      stats.loadStats();
      if (selectedImage) api.getImageDetail(selectedImage.id).then(setSelectedImage).catch(() => {});
    }).then(unlisten => unlisteners.push(unlisten));
    listen<{ total: number }>('reparse-finished', () => {
      setReparseProgress(null);
      setIsRefreshing(false);
      gallery.loadImages(true);
      favorites.loadFavorites();
      stats.loadStats();
      if (selectedImage) {
        api.getImageDetail(selectedImage.id).then(setSelectedImage).catch(() => {});
      }
    }).then(unlisten => unlisteners.push(unlisten));

    return () => { unlisteners.forEach(unlisten => unlisten()); };
  }, [favorites, gallery, selectedImage, stats]);

  // 监听操作系统级别的文件拖拽事件（Tauri 原生拖放）
  useEffect(() => {
    let disposed = false;
    dropCleanupRef.current?.();
    dropCleanupRef.current = null;

    try {
      getCurrentWindow().onDragDropEvent((event) => {
        if (event.payload.type === 'over') {
          setIsDraggingOver(true);
        } else if (event.payload.type === 'drop') {
          setIsDraggingOver(false);
          // 仅过滤当前后端可解析元数据的图片格式
          const imagePaths = (event.payload.paths as string[]).filter(
            (p: string) => supportedImageExtensions.some(ext => p.toLowerCase().endsWith(ext))
          );
          if (imagePaths.length > 0) {
            handleDropFilesRef.current(imagePaths);
          }
        } else {
          setIsDraggingOver(false);
        }
      }).then(fn => {
        if (disposed) {
          fn();
        } else {
          dropCleanupRef.current = fn;
        }
      });
    } catch {
      // 非 Tauri 环境（如浏览器开发）忽略
    }
    return () => {
      disposed = true;
      dropCleanupRef.current?.();
      dropCleanupRef.current = null;
    };
  }, []);

  // 通过文件对话框选择支持的图片文件导入
  const handleImport = useCallback(async () => {
    try {
      const files = await open({
        multiple: true,
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
      });
      if (!files) return;
      const filePaths = Array.isArray(files) ? files : [files];
      // 先进入准备态，避免快速跳过/失败时完成事件早于 invoke 返回，导致 queued 状态覆盖完成态。
      setImportProgress({ phase: 'queued', done: 0, total: filePaths.length });
      await api.startImportImages(filePaths);
    } catch (e) {
      console.error('Import failed:', e);
    }
  }, [gallery, stats]);

  // 选择文件夹批量导入
  const handleImportFolder = useCallback(async () => {
    try {
      const folder = await open({ directory: true });
      if (!folder) return;
      setImportProgress({ phase: 'scanning', done: 0, total: 0, current: folder as string });
      await api.startImportFolder(folder as string);
    } catch (e) {
      console.error('Folder import failed:', e);
    }
  }, [gallery, stats]);

  // 处理拖拽文件导入
  const handleDropFiles = useCallback(async (files: string[]) => {
    try {
      setImportProgress({ phase: 'queued', done: 0, total: files.length });
      await api.startImportImages(files);
    } catch (e) {
      console.error('Drop import failed:', e);
    }
  }, []);

  useEffect(() => {
    handleDropFilesRef.current = handleDropFiles;
  }, [handleDropFiles]);

  // 删除图片：关闭详情面板，刷新统计
  const handleDelete = useCallback(async (id: number) => {
    try {
      await gallery.deleteImage(id);
      setSelectedImage(null);
      stats.loadStats();
    } catch (e) {
      console.error('Delete failed:', e);
    }
  }, [gallery, stats]);

  // 切换收藏状态：同步更新列表和详情中的状态
  const handleToggleFavorite = useCallback(async (imageId: number) => {
    try {
      const newState = await favorites.toggleFavorite(imageId);
      gallery.setImages(prev =>
        prev.map(img => img.id === imageId ? { ...img, is_favorite: newState } : img)
      );
      if (selectedImage?.id === imageId) {
        setSelectedImage(prev => prev ? { ...prev, is_favorite: newState } : null);
      }
    } catch (e) {
      console.error('Toggle favorite failed:', e);
    }
  }, [favorites, gallery, selectedImage]);

  // 更新提示词：保存后刷新列表和详情
  const handleUpdatePrompt = useCallback(async (imageId: number, positive: string, negative: string) => {
    try {
      await api.updatePrompt(imageId, positive, negative);
      gallery.loadImages(true);
      if (selectedImage?.id === imageId) {
        const updated = await api.getImageDetail(imageId);
        setSelectedImage(updated);
      }
    } catch (e) {
      console.error('Update prompt failed:', e);
    }
  }, [gallery, selectedImage]);

  // 重新解析元数据：写回数据库后刷新列表、详情和统计。
  const handleReparseMetadata = useCallback(async (imageId: number) => {
    try {
      const updated = await api.reparseImageMetadata(imageId);
      gallery.loadImages(true);
      stats.loadStats();
      if (selectedImage?.id === imageId) {
        setSelectedImage(updated);
      }
    } catch (e) {
      console.error('Reparse metadata failed:', e);
      throw e;
    }
  }, [gallery, stats, selectedImage]);

  // 顶部刷新：批量重新解析图库元数据，进度通过后端事件反馈。
  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    setReparseProgress({ done: 0, total: 0 });
    try {
      await api.startReparseAllMetadata();
    } catch (e) {
      setIsRefreshing(false);
      setReparseProgress(null);
      console.error('Batch reparse metadata failed:', e);
    }
  }, [isRefreshing]);

  // 视图导航切换
  const handleNavigate = useCallback((newView: ViewType) => {
    setView(newView);
    if (newView === 'favorites') {
      favorites.loadFavorites();
    }
    setSelectedImage(null);
  }, [favorites]);

  // 根据当前视图选择数据源：收藏页用 favorites，画廊页用 gallery
  const rawImages = view === 'favorites' ? favorites.favorites : gallery.images;
  const currentImages = nsfw.filterImages(rawImages); // 应用 NSFW 过滤
  const currentLoading = view === 'favorites' ? favorites.loading : gallery.loading;
  // 记录上一次随机图片 ID，避免连续点击重复
  const lastRandomIdRef = useRef<number | null>(null);
  const handleRandomImage = useCallback(() => {
    if (currentImages.length === 0) return;
    let image;
    if (currentImages.length === 1) {
      // 仅一张图片时无法避免重复，直接使用
      image = currentImages[0];
    } else {
      // 重复随机直到选到与上次不同的图片
      do {
        image = currentImages[Math.floor(Math.random() * currentImages.length)];
      } while (image.id === lastRandomIdRef.current);
    }
    lastRandomIdRef.current = image.id;
    setScrollToImageId(image.id);
    setSelectedImage(image);
  }, [currentImages]);

  const searchCandidates = useMemo(() => {
    const counts = new Map<string, number>();
    const addTag = (tag: string) => {
      const normalized = tag.trim().toLowerCase();
      if (normalized.length < 2 || normalized.length > 64) return;
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    };

    for (const image of rawImages) {
      image.tags.forEach(addTag);
      const prompt = image.prompt || '';
      prompt.split(',').forEach(part => {
        const tag = part.replace(/[()\[\]{}]/g, '').replace(/:[\d.]+/g, '').trim();
        if (/^[\w\s.'+-]+$/.test(tag)) addTag(tag);
      });
      image.ai_annotation?.tags_en.forEach(addTag);
      image.ai_annotation?.tags_zh.forEach(addTag);
    }

    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 240)
      .map(([tag]) => tag);
  }, [rawImages]);

  return (
    <div className="flex flex-col h-screen bg-ink-bg overflow-hidden">
      <div className="flex flex-1 overflow-hidden">
        {/* 左侧导航栏：视图切换、过滤、排序、模型列表 */}
        <Sidebar
          activeView={view}
          onNavigate={handleNavigate}
          stats={stats.stats}
          onImport={handleImport}
          onImportFolder={handleImportFolder}
          hideNSFW={nsfw.hideNSFW}
          onToggleNSFW={() => {
            nsfw.toggleNSFW();
            setSelectedImage(null);
          }}
          nsfwTags={[...nsfw.nsfwTags]}
          onAddNSFWTag={nsfw.addNSFWTag}
          onRemoveNSFWTag={nsfw.removeNSFWTag}
          onRefresh={handleRefresh}
          isRefreshing={isRefreshing}
          refreshProgress={reparseProgress ?? undefined}
          sortBy={gallery.sortBy}
          onSortByChange={gallery.setSortBy}
          sortDir={gallery.sortDir}
          onSortDirChange={gallery.setSortDir}
          galleryDensity={galleryDensity}
          onGalleryDensityChange={setGalleryDensity}
          importProgress={importProgress}
          importResult={importResult}
          reparseProgress={reparseProgress}
          backupProgress={backupProgress}
          backupResult={backupResult}
          aiTagProgress={aiTagProgress}
          aiTagResult={aiTagResult}
        />

        {/* 主内容区：搜索栏 + 图片网格 */}
        <main className="flex-1 flex flex-col overflow-hidden">
          <Header
            searchQuery={gallery.searchQuery}
            setSearchQuery={gallery.setSearchQuery}
            imageCount={currentImages.length}
            totalCount={view === 'gallery' ? stats.stats?.total_images : undefined}
            onRandomImage={handleRandomImage}
            randomDisabled={currentImages.length === 0}
            onOpenSettings={() => setSettingsOpen(true)}
            searchCandidates={searchCandidates}
          />

          <GalleryGrid
            images={currentImages}
            loading={currentLoading}
            hasMore={view === 'gallery' ? gallery.hasMore : false}
            selectedId={selectedImage?.id ?? null}
            onSelect={setSelectedImage}
            onToggleFavorite={handleToggleFavorite}
            onHideImage={nsfw.hideImage}
            isImageHidden={nsfw.isImageHidden}
            onUnhideImage={nsfw.unhideImage}
            onLoadMore={gallery.loadMore}
            onViewportCapacityChange={gallery.setLoadLimit}
            scrollToImageId={scrollToImageId}
            density={galleryDensity}
          />
        </main>

        <SettingsPage
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          backupProgress={backupProgress}
          backupResult={backupResult}
          onBackupProgressReset={() => {
            setBackupProgress(null);
            setBackupResult(null);
          }}
        />

        {/* 右侧图片详情面板：元数据、提示词编辑、操作按钮 */}
        {selectedImage && (
          <ImageDetail
            image={selectedImage}
            onClose={() => setSelectedImage(null)}
            onDelete={handleDelete}
            onToggleFavorite={handleToggleFavorite}
            onUpdatePrompt={handleUpdatePrompt}
            onReparseMetadata={handleReparseMetadata}
          />
        )}
      </div>

      {/* 全屏拖拽遮罩：文件悬停时显示 */}
      {isDraggingOver && (
        <div className="fixed inset-0 z-[100] bg-ink-bg/80 backdrop-blur-sm flex items-center justify-center pointer-events-none">
          <div className="rounded-card border-2 border-dashed border-ink-muted px-12 py-8 bg-ink-bg">
            <p className="font-display font-bold text-xl text-ink text-center">
              {t.import.dropHere}
            </p>
            <p className="text-sm text-ink-muted text-center mt-2">
              {importProgress ? t.import.dropImporting : t.import.dropHint}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
