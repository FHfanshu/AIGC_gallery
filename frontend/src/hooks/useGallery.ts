import { useState, useCallback, useEffect } from 'react';
import { api } from '../lib/tauri';
import type { ImageRecord } from '../types';

export function useGallery() {
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const limit = 50;

  const loadImages = useCallback(async (reset = true) => {
    setLoading(true);
    setError(null);
    try {
      const off = reset ? 0 : offset;
      let imgs: ImageRecord[];
      if (selectedTag) {
        imgs = await api.getImagesByTag(selectedTag, off, limit);
      } else {
        imgs = await api.getImages(off, limit, searchQuery);
      }
      if (reset) {
        setImages(imgs);
        setOffset(limit);
      } else {
        setImages(prev => [...prev, ...imgs]);
        setOffset(prev => prev + limit);
      }
      setHasMore(imgs.length === limit);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [searchQuery, selectedTag, offset]);

  const loadMore = useCallback(() => {
    if (!loading && hasMore) {
      loadImages(false);
    }
  }, [loading, hasMore, loadImages]);

  const deleteImage = useCallback(async (id: number) => {
    await api.deleteImage(id);
    setImages(prev => prev.filter(img => img.id !== id));
  }, []);

  useEffect(() => {
    loadImages(true);
  }, [searchQuery, selectedTag]);

  return {
    images, loading, error, searchQuery, setSearchQuery,
    selectedTag, setSelectedTag, hasMore,
    loadImages, loadMore, deleteImage, setImages,
  };
}
