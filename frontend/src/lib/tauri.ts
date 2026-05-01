import { invoke } from '@tauri-apps/api/core';
import type { ImageRecord, TagRecord, ImageStats, ImportResult } from '../types';

export const api = {
  getImages: (offset = 0, limit = 50, search?: string | null) =>
    invoke<ImageRecord[]>('get_images', { offset, limit, search: search || null }),
  
  getImageDetail: (id: number) =>
    invoke<ImageRecord>('get_image_detail', { id }),
  
  importImages: (filePaths: string[]) =>
    invoke<ImportResult>('import_images', { filePaths }),
  
  importFolder: (folderPath: string) =>
    invoke<ImportResult>('import_folder', { folderPath }),
  
  deleteImage: (id: number) =>
    invoke('delete_image', { id }),
  
  toggleFavorite: (imageId: number) =>
    invoke<boolean>('toggle_favorite', { imageId }),
  
  getFavorites: (offset = 0, limit = 50) =>
    invoke<ImageRecord[]>('get_favorites', { offset, limit }),
  
  updatePrompt: (imageId: number, positivePrompt: string, negativePrompt: string) =>
    invoke('update_prompt', { imageId, positivePrompt, negativePrompt }),
  
  getAllTags: () =>
    invoke<TagRecord[]>('get_all_tags'),
  
  addTag: (name: string, color?: string) =>
    invoke<number>('add_tag', { name, color: color || '#6C63FF' }),
  
  removeTag: (tagId: number) =>
    invoke('remove_tag', { tagId }),
  
  getImagesByTag: (tagName: string, offset = 0, limit = 50) =>
    invoke<ImageRecord[]>('get_images_by_tag', { tagName, offset, limit }),
  
  updateImageTags: (imageId: number, tagIds: number[]) =>
    invoke('update_image_tags', { imageId, tagIds }),
  
  getStats: () =>
    invoke<ImageStats>('get_stats'),

  getStorageConfig: () =>
    invoke<{ storage_dir: string | null; resolved_dir: string }>('get_storage_config'),

  setStorageDir: (dir: string | null) =>
    invoke<{ storage_dir: string | null; resolved_dir: string }>('set_storage_dir', { dir }),

  getImageBase64: (imageId: number, useThumbnail = true) =>
    invoke<string>('get_image_base64', { imageId, useThumbnail }),
};
