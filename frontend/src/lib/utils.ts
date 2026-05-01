import { convertFileSrc } from '@tauri-apps/api/core';

export function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

export function getImageSrc(path: string | null | undefined): string {
  if (!path) return '';
  try {
    return convertFileSrc(path);
  } catch {
    return '';
  }
}

export function parseMetadata(json: string) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function truncate(str: string, len: number): string {
  return str.length > len ? str.slice(0, len) + '...' : str;
}

export function getSourceLabel(source: string): { label: string; color: string } {
  const map: Record<string, { label: string; color: string }> = {
    a1111: { label: 'A1111', color: '#22c55e' },
    comfyui: { label: 'ComfyUI', color: '#3b82f6' },
    novelai: { label: 'NovelAI', color: '#f472b6' },
    unknown: { label: 'Unknown', color: '#6b7280' },
  };
  return map[source] || map.unknown;
}

export function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout>;
  return ((...args: any[]) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as T;
}
