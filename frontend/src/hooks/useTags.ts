import { useState, useCallback, useEffect } from 'react';
import { api } from '../lib/tauri';
import type { TagRecord } from '../types';

export function useTags() {
  const [tags, setTags] = useState<TagRecord[]>([]);

  const loadTags = useCallback(async () => {
    try {
      setTags(await api.getAllTags());
    } catch (e) {
      console.error('Failed to load tags:', e);
    }
  }, []);

  const addTag = useCallback(async (name: string, color?: string) => {
    await api.addTag(name, color);
    await loadTags();
  }, [loadTags]);

  const removeTag = useCallback(async (tagId: number) => {
    await api.removeTag(tagId);
    await loadTags();
  }, [loadTags]);

  useEffect(() => { loadTags(); }, [loadTags]);

  return { tags, loadTags, addTag, removeTag };
}
