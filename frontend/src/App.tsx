// 应用根组件
// 负责视图路由（画廊/收藏）、图片导入、拖拽上传、事件编排
// 组合 Sidebar + Header + GalleryGrid + ImageDetail 四大布局区域

import { useState, useCallback, useEffect, useRef } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { Sidebar } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { GalleryGrid } from './components/gallery/GalleryGrid';
import { ImageDetail } from './components/gallery/ImageDetail';
import { useGallery, useFavorites, useStats, useNSFWFilter } from './hooks';
import { api } from './lib/tauri';
import { useI18n } from './i18n';
import type { ImageRecord, ImportResult, ViewType } from './types';

function App() {
  // 当前视图：gallery（画廊）/ favorites（收藏）
  const [view, setView] = useState<ViewType>('gallery');
  // 当前选中查看详情的图片
  const [selectedImage, setSelectedImage] = useState<ImageRecord | null>(null);
  // 导入结果提示（成功/跳过/错误数量）
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  // 导入进度：后端通过事件推送 { done, total }
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null);
  // 拖拽文件悬停状态（用于显示全屏遮罩）
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  const nsfw = useNSFWFilter();
  const gallery = useGallery();
  const favorites = useFavorites();
  const stats = useStats();
  const { t } = useI18n();
  const dropCleanupRef = useRef<(() => void) | null>(null);
  const handleDropFilesRef = useRef<(files: string[]) => void>(() => {});

  // 监听后端推送的导入进度和完成事件
  useEffect(() => {
    const unlisteners: Array<() => void> = [];
    // 导入进度更新：显示已完成/总数
    listen<{ done: number; total: number }>('import-progress', event => {
      setImportProgress({ done: event.payload.done, total: event.payload.total });
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

    return () => { unlisteners.forEach(unlisten => unlisten()); };
  }, [gallery, stats]);

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
          // 仅过滤 PNG 文件
          const pngPaths = (event.payload.paths as string[]).filter(
            (p: string) => p.toLowerCase().endsWith('.png')
          );
          if (pngPaths.length > 0) {
            handleDropFilesRef.current(pngPaths);
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

  // 通过文件对话框选择 PNG 文件导入
  const handleImport = useCallback(async () => {
    try {
      const files = await open({
        multiple: true,
        filters: [{ name: 'Images', extensions: ['png'] }],
      });
      if (!files) return;
      const filePaths = Array.isArray(files) ? files : [files];
      // 启动后端异步导入，进度通过事件推送
      await api.startImportImages(filePaths);
      setImportProgress({ done: 0, total: filePaths.length });
    } catch (e) {
      console.error('Import failed:', e);
    }
  }, [gallery, stats]);

  // 选择文件夹批量导入
  const handleImportFolder = useCallback(async () => {
    try {
      const folder = await open({ directory: true });
      if (!folder) return;
      await api.startImportFolder(folder as string);
      setImportProgress({ done: 0, total: 0 });
    } catch (e) {
      console.error('Folder import failed:', e);
    }
  }, [gallery, stats]);

  // 处理拖拽文件导入
  const handleDropFiles = useCallback(async (files: string[]) => {
    try {
      await api.startImportImages(files);
      setImportProgress({ done: 0, total: files.length });
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

  return (
    <div className="flex h-screen bg-ink-bg overflow-hidden">
      {/* 左侧导航栏：视图切换、存储配置、统计信息 */}
      <Sidebar
        activeView={view}
        onNavigate={handleNavigate}
        stats={stats.stats}
        onImport={handleImport}
        onImportFolder={handleImportFolder}
        importResult={importResult}
        importProgress={importProgress}
      />

      {/* 主内容区：搜索栏 + 图片网格 */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <Header
          searchQuery={gallery.searchQuery}
          setSearchQuery={gallery.setSearchQuery}
          imageCount={view === 'gallery' && !gallery.searchQuery.trim() && !nsfw.hideNSFW ? (stats.stats?.total_images ?? currentImages.length) : currentImages.length}
          loadedCount={view === 'gallery' ? currentImages.length : undefined}
          totalCount={view === 'gallery' && !gallery.searchQuery.trim() && !nsfw.hideNSFW ? stats.stats?.total_images : undefined}
          hideNSFW={nsfw.hideNSFW}
          onToggleNSFW={() => {
            nsfw.toggleNSFW();
            setSelectedImage(null);
          }}
          nsfwTags={[...nsfw.nsfwTags]}
          onAddNSFWTag={nsfw.addNSFWTag}
          onRemoveNSFWTag={nsfw.removeNSFWTag}
          onRefresh={() => {
            gallery.refresh();
            favorites.refresh();
            stats.refresh();
          }}
          sortBy={gallery.sortBy}
          onSortByChange={gallery.setSortBy}
          sortDir={gallery.sortDir}
          onSortDirChange={gallery.setSortDir}
        />

        <GalleryGrid
          images={currentImages}
          loading={currentLoading}
          hasMore={view === 'gallery' ? gallery.hasMore : false}
          selectedId={selectedImage?.id ?? null}
          onSelect={setSelectedImage}
          onToggleFavorite={handleToggleFavorite}
          onHideImage={nsfw.hideImage}
          onLoadMore={gallery.loadMore}
          onViewportCapacityChange={gallery.setLoadLimit}
        />
      </main>

      {/* 右侧图片详情面板：元数据、提示词编辑、操作按钮 */}
      {selectedImage && (
        <ImageDetail
          image={selectedImage}
          onClose={() => setSelectedImage(null)}
          onDelete={handleDelete}
          onToggleFavorite={handleToggleFavorite}
          onUpdatePrompt={handleUpdatePrompt}
        />
      )}

      {/* 全屏拖拽遮罩：文件悬停时显示 */}
      {isDraggingOver && (
        <div className="fixed inset-0 z-[100] bg-ink-bg/80 backdrop-blur-sm flex items-center justify-center pointer-events-none">
          <div className="rounded-card border-2 border-dashed border-ink-muted px-12 py-8 bg-ink-bg">
            <p className="font-display font-bold text-xl text-ink text-center">
              {t.import.dropHere}
            </p>
            <p className="text-sm text-ink-muted text-center mt-2">
              {t.import.dropHint}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
