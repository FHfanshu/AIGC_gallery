// Tauri IPC API 封装层 — 统一封装前端调用后端 Rust 命令的所有接口
// 通过 @tauri-apps/api/core 的 invoke 方法实现跨进程通信

import { invoke } from '@tauri-apps/api/core';
import type { ImageRecord, ImageStats, ImportResult } from '../types';

/** api — 所有 Tauri IPC 调用的统一入口对象 */
export const api = {
  /** 分页获取图片列表，支持关键词搜索 */
  getImages: (offset = 0, limit = 50, search?: string | null) =>
    invoke<ImageRecord[]>('get_images', { offset, limit, search: search || null }),
  
  /** 获取单张图片的详细信息 */
  getImageDetail: (id: number) =>
    invoke<ImageRecord>('get_image_detail', { id }),
  
  /** 导入指定路径的图片文件列表（同步阻塞） */
  importImages: (filePaths: string[]) =>
    invoke<ImportResult>('import_images', { filePaths }),

  /** 异步启动批量导入图片任务（不阻塞前端） */
  startImportImages: (filePaths: string[]) =>
    invoke<void>('start_import_images', { filePaths }),
  
  /** 导入整个文件夹中的图片（同步阻塞） */
  importFolder: (folderPath: string) =>
    invoke<ImportResult>('import_folder', { folderPath }),

  /** 异步启动导入文件夹任务（不阻塞前端） */
  startImportFolder: (folderPath: string) =>
    invoke<void>('start_import_folder', { folderPath }),
  
  /** 删除指定图片（同时清理关联的缩略图和元数据） */
  deleteImage: (id: number) =>
    invoke('delete_image', { id }),
  
  /** 切换图片收藏状态，返回切换后的新状态 */
  toggleFavorite: (imageId: number) =>
    invoke<boolean>('toggle_favorite', { imageId }),
  
  /** 分页获取已收藏的图片列表 */
  getFavorites: (offset = 0, limit = 50) =>
    invoke<ImageRecord[]>('get_favorites', { offset, limit }),
  
  /** 更新图片的正向/反向提示词 */
  updatePrompt: (imageId: number, positivePrompt: string, negativePrompt: string) =>
    invoke('update_prompt', { imageId, positivePrompt, negativePrompt }),
  
  /** 获取图库统计数据（图片总数、标签总数、模型分布） */
  getStats: () =>
    invoke<ImageStats>('get_stats'),

  /** 获取当前存储目录配置 */
  getStorageConfig: () =>
    invoke<{ storage_dir: string | null; resolved_dir: string }>('get_storage_config'),

  /** 设置自定义存储目录（传 null 恢复默认） */
  setStorageDir: (dir: string | null) =>
    invoke<{ storage_dir: string | null; resolved_dir: string }>('set_storage_dir', { dir }),

  /** 获取图片的 Base64 编码数据，用于前端显示 */
  getImageBase64: (imageId: number, useThumbnail = true) =>
    invoke<string>('get_image_base64', { imageId, useThumbnail }),
};
