import { useState, useCallback, useEffect } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Sidebar } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { GalleryGrid } from './components/gallery/GalleryGrid';
import { ImageDetail } from './components/gallery/ImageDetail';
import { useGallery, useTags, useFavorites, useStats } from './hooks';
import { api } from './lib/tauri';
import type { ImageRecord, ImportResult, ViewType } from './types';

function App() {
  const [view, setView] = useState<ViewType>('gallery');
  const [selectedImage, setSelectedImage] = useState<ImageRecord | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  const gallery = useGallery();
  const tags = useTags();
  const favorites = useFavorites();
  const stats = useStats();

  // Tauri native drag-and-drop: listen for OS file drops anywhere on the window
  useEffect(() => {
    const unlisten = getCurrentWindow().onDragDropEvent((event) => {
      if (event.payload.type === 'over') {
        setIsDraggingOver(true);
      } else if (event.payload.type === 'drop') {
        setIsDraggingOver(false);
        const pngPaths = (event.payload.paths as string[]).filter(
          (p: string) => p.toLowerCase().endsWith('.png')
        );
        if (pngPaths.length > 0) {
          handleDropFiles(pngPaths);
        }
      } else {
        // cancelled
        setIsDraggingOver(false);
      }
    });
    return () => { unlisten.then(fn => fn()); };
  }, []);

  // Import handlers
  const handleImport = useCallback(async () => {
    try {
      const files = await open({
        multiple: true,
        filters: [{ name: 'Images', extensions: ['png'] }],
      });
      if (!files) return;
      const filePaths = Array.isArray(files) ? files : [files];
      const result = await api.importImages(filePaths);
      setImportResult(result);
      setTimeout(() => setImportResult(null), 5000);
      if (result.success.length > 0) {
        gallery.loadImages(true);
        tags.loadTags();
        stats.loadStats();
      }
    } catch (e) {
      console.error('Import failed:', e);
    }
  }, [gallery, tags, stats]);

  const handleImportFolder = useCallback(async () => {
    try {
      const folder = await open({ directory: true });
      if (!folder) return;
      const result = await api.importFolder(folder as string);
      setImportResult(result);
      setTimeout(() => setImportResult(null), 5000);
      if (result.success.length > 0) {
        gallery.loadImages(true);
        tags.loadTags();
        stats.loadStats();
      }
    } catch (e) {
      console.error('Folder import failed:', e);
    }
  }, [gallery, tags, stats]);

  const handleDropFiles = useCallback(async (files: string[]) => {
    try {
      const result = await api.importImages(files);
      setImportResult(result);
      setTimeout(() => setImportResult(null), 5000);
      if (result.success.length > 0) {
        gallery.loadImages(true);
        tags.loadTags();
        stats.loadStats();
      }
    } catch (e) {
      console.error('Drop import failed:', e);
    }
  }, [gallery, tags, stats]);

  // Delete handler
  const handleDelete = useCallback(async (id: number) => {
    try {
      await gallery.deleteImage(id);
      setSelectedImage(null);
      stats.loadStats();
      tags.loadTags();
    } catch (e) {
      console.error('Delete failed:', e);
    }
  }, [gallery, stats, tags]);

  // Favorite handler
  const handleToggleFavorite = useCallback(async (imageId: number) => {
    try {
      const newState = await favorites.toggleFavorite(imageId);
      // Update image in gallery list
      gallery.setImages(prev =>
        prev.map(img => img.id === imageId ? { ...img, is_favorite: newState } : img)
      );
      // Update selected image if it's the one toggled
      if (selectedImage?.id === imageId) {
        setSelectedImage(prev => prev ? { ...prev, is_favorite: newState } : null);
      }
    } catch (e) {
      console.error('Toggle favorite failed:', e);
    }
  }, [favorites, gallery, selectedImage]);

  // Tag handlers
  const handleUpdateTags = useCallback(async (imageId: number, tagName: string) => {
    const image = gallery.images.find(i => i.id === imageId) || (selectedImage?.id === imageId ? selectedImage : null);
    if (!image) return;

    const tag = tags.tags.find(t => t.name === tagName);
    if (!tag) return;

    const currentTagIds = tags.tags
      .filter(t => image.tags.includes(t.name))
      .map(t => t.id);

    let newTagIds: number[];
    if (image.tags.includes(tagName)) {
      newTagIds = currentTagIds.filter(id => id !== tag.id);
    } else {
      newTagIds = [...currentTagIds, tag.id];
    }

    try {
      await api.updateImageTags(imageId, newTagIds);
      gallery.loadImages(true);
      tags.loadTags();
      if (selectedImage?.id === imageId) {
        const updated = await api.getImageDetail(imageId);
        setSelectedImage(updated);
      }
    } catch (e) {
      console.error('Toggle tag failed:', e);
    }
  }, [gallery, tags, selectedImage]);

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

  // Navigation
  const handleNavigate = useCallback((newView: ViewType) => {
    setView(newView);
    if (newView === 'favorites') {
      favorites.loadFavorites();
    }
    setSelectedImage(null);
  }, [favorites]);

  // Determine current image list based on view
  const currentImages = view === 'favorites' ? favorites.favorites : gallery.images;
  const currentLoading = view === 'favorites' ? favorites.loading : gallery.loading;

  return (
    <div className="flex h-screen bg-neu-bg overflow-hidden">
      <Sidebar
        activeView={view}
        onNavigate={handleNavigate}
        tags={tags.tags}
        stats={stats.stats}
        onImport={handleImport}
        onImportFolder={handleImportFolder}
        onAddTag={tags.addTag}
        onRemoveTag={tags.removeTag}
        selectedTag={gallery.selectedTag}
        onSelectTag={gallery.setSelectedTag}
        importResult={importResult}
      />

      <main className="flex-1 flex flex-col overflow-hidden">
        <Header
          searchQuery={gallery.searchQuery}
          setSearchQuery={gallery.setSearchQuery}
          selectedTag={gallery.selectedTag}
          clearTag={() => gallery.setSelectedTag(null)}
          imageCount={currentImages.length}
        />

        <GalleryGrid
          images={currentImages}
          loading={currentLoading}
          hasMore={view === 'gallery' ? gallery.hasMore : false}
          selectedId={selectedImage?.id ?? null}
          onSelect={setSelectedImage}
          onToggleFavorite={handleToggleFavorite}
          onLoadMore={gallery.loadMore}
        />
      </main>

      {selectedImage && (
        <ImageDetail
          image={selectedImage}
          tags={tags.tags}
          onClose={() => setSelectedImage(null)}
          onDelete={handleDelete}
          onToggleFavorite={handleToggleFavorite}
          onUpdateTags={handleUpdateTags}
          onUpdatePrompt={handleUpdatePrompt}
        />
      )}

      {/* Global drag overlay for OS-level file drops */}
      {isDraggingOver && (
        <div className="fixed inset-0 z-[100] bg-neu-accent/10 backdrop-blur-sm flex items-center justify-center pointer-events-none">
          <div className="neu-inset-deep rounded-[32px] px-12 py-8 border-2 border-dashed border-neu-accent/40">
            <p className="font-display font-bold text-2xl text-neu-accent text-center">
              Drop PNG files here
            </p>
            <p className="text-sm text-neu-muted text-center mt-2">
              Images will be imported with metadata auto-detected
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
