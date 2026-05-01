import { useState, useCallback, useEffect } from 'react';
import { api } from '../lib/tauri';
import type { ImageStats } from '../types';

export function useStats() {
  const [stats, setStats] = useState<ImageStats | null>(null);

  const loadStats = useCallback(async () => {
    try {
      setStats(await api.getStats());
    } catch (e) {
      console.error('Failed to load stats:', e);
    }
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);

  return { stats, loadStats };
}
