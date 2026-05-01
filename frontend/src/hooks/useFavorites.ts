import { useState, useCallback } from 'react';
import { api } from '../lib/tauri';
import type { ImageRecord } from '../types';

export function useFavorites() {
  const [favorites, setFavorites] = useState<ImageRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const loadFavorites = useCallback(async () => {
    setLoading(true);
    try {
      setFavorites(await api.getFavorites());
    } catch (e) {
      console.error('Failed to load favorites:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const toggleFavorite = useCallback(async (imageId: number): Promise<boolean> => {
    const newState = await api.toggleFavorite(imageId);
    return newState;
  }, []);

  return { favorites, loading, loadFavorites, toggleFavorite, setFavorites };
}
