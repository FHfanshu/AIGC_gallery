// Tauri IPC API 封装层 — 统一封装前端调用后端 Rust 命令的所有接口
// 通过 @tauri-apps/api/core 的 invoke 方法实现跨进程通信

import { invoke } from '@tauri-apps/api/core';
import type { CivitaiBaseUrl, CivitaiKeyStatus, CivitaiLookupResult, ImageRecord, ImageStats, ImportResult, ImportStrategy, StorageConfig } from '../types';

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
  startImportImages: (filePaths: string[], importStrategy?: ImportStrategy) =>
    invoke<void>('start_import_images', { filePaths, importStrategy: importStrategy || null }),
  
  /** 导入整个文件夹中的图片（同步阻塞） */
  importFolder: (folderPath: string) =>
    invoke<ImportResult>('import_folder', { folderPath }),

  /** 异步启动导入文件夹任务（不阻塞前端） */
  startImportFolder: (folderPath: string, importStrategy?: ImportStrategy) =>
    invoke<void>('start_import_folder', { folderPath, importStrategy: importStrategy || null }),
  
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
    invoke<StorageConfig>('get_storage_config'),

  /** 设置自定义存储目录（传 null 恢复默认）和导入策略 */
  setStorageDir: (dir: string | null, importStrategy?: ImportStrategy, civitaiBaseUrl?: CivitaiBaseUrl) =>
    invoke<StorageConfig>('set_storage_dir', { dir, importStrategy: importStrategy || null, civitaiBaseUrl: civitaiBaseUrl || null }),

  /** 获取图片的 Base64 编码数据，用于前端显示 */
  getImageBase64: (imageId: number, useThumbnail = true) =>
    invoke<string>('get_image_base64', { imageId, useThumbnail }),

  /** 查询系统凭据库里是否保存了 Civitai API Key */
  getCivitaiKeyStatus: () =>
    invoke<CivitaiKeyStatus>('get_civitai_key_status'),

  /** 保存 Civitai API Key 到系统凭据库，传空字符串可清除 */
  setCivitaiApiKey: (apiKey: string) =>
    invoke<CivitaiKeyStatus>('set_civitai_api_key', { apiKey }),

  /** 通过模型文件 hash 查询 Civitai 模型版本信息 */
  lookupCivitaiByHash: (hash: string) =>
    invoke<CivitaiLookupResult | null>('lookup_civitai_by_hash', { hash }),

  /** 导出图库数据到 zip 文件，返回结果描述 */
  exportGallery: (destPath: string) =>
    invoke<string>('export_gallery', { destPath }),

  /** 从 zip 文件导入图库数据，返回结果描述 */
  importGallery: (zipPath: string) =>
    invoke<string>('import_gallery', { zipPath }),
};
