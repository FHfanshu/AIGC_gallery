// Tauri IPC API 封装层 — 统一封装前端调用后端 Rust 命令的所有接口
// 通过 @tauri-apps/api/core 的 invoke 方法实现跨进程通信

import { invoke } from '@tauri-apps/api/core';
import type { AiTagConfig, AiTagKeyStatus, CivitaiBaseUrl, CivitaiKeyStatus, CivitaiLookupResult, ImageRecord, ImageStats, ImportResult, ImportStrategy, StorageConfig, TagRecord } from '../types';

const imageBase64Cache = new Map<string, Promise<string>>();
const thumbnailQueue: Array<() => void> = [];
let activeThumbnailLoads = 0;
const MAX_THUMBNAIL_LOADS = 4;

function enqueueThumbnailLoad<T>(task: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = () => {
      activeThumbnailLoads += 1;
      task()
        .then(resolve, reject)
        .finally(() => {
          activeThumbnailLoads -= 1;
          thumbnailQueue.shift()?.();
        });
    };

    if (activeThumbnailLoads < MAX_THUMBNAIL_LOADS) {
      run();
    } else {
      thumbnailQueue.push(run);
    }
  });
}

function imageBase64Key(imageId: number, useThumbnail: boolean) {
  return `${imageId}:${useThumbnail ? 'thumb' : 'full'}`;
}

function getCachedImageBase64(imageId: number, useThumbnail: boolean) {
  const key = imageBase64Key(imageId, useThumbnail);
  const cached = imageBase64Cache.get(key);
  if (cached) return cached;

  // 原图 Base64 体积较大，只保留最近 6 张预取/打开过的原图，避免长时间浏览占用过多内存。
  if (!useThumbnail) {
    const fullKeys = Array.from(imageBase64Cache.keys()).filter(k => k.endsWith(':full'));
    for (const oldKey of fullKeys.slice(0, Math.max(0, fullKeys.length - 5))) {
      imageBase64Cache.delete(oldKey);
    }
  }

  const load = () => invoke<string>('get_image_base64', { imageId, useThumbnail });
  const promise = (useThumbnail ? enqueueThumbnailLoad(load) : load())
    .catch(error => {
      imageBase64Cache.delete(key);
      throw error;
    });
  imageBase64Cache.set(key, promise);
  return promise;
}

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

  /** 获取所有标签 */
  getAllTags: () =>
    invoke<TagRecord[]>('get_all_tags'),

  /** 新增标签 */
  addTag: (name: string, color?: string) =>
    invoke('add_tag', { name, color: color || null }),

  /** 删除标签 */
  removeTag: (tagId: number) =>
    invoke('remove_tag', { tagId }),
  
  /** 分页获取已收藏的图片列表 */
  getFavorites: (offset = 0, limit = 50) =>
    invoke<ImageRecord[]>('get_favorites', { offset, limit }),
  
  /** 更新图片的正向/反向提示词 */
  updatePrompt: (imageId: number, positivePrompt: string, negativePrompt: string) =>
    invoke('update_prompt', { imageId, positivePrompt, negativePrompt }),

  /** 重新解析图片文件中的 PNG 元数据并刷新数据库记录 */
  reparseImageMetadata: (imageId: number) =>
    invoke<ImageRecord>('reparse_image_metadata', { imageId }),

  /** 异步启动全图库元数据重新解析，进度通过 reparse-progress / reparse-finished 事件推送 */
  startReparseAllMetadata: () =>
    invoke<void>('start_reparse_all_metadata'),
  
  /** 获取图库统计数据（图片总数、标签总数、模型分布） */
  getStats: () =>
    invoke<ImageStats>('get_stats'),

  /** 获取当前存储目录配置 */
  getStorageConfig: () =>
    invoke<StorageConfig>('get_storage_config'),

  /** 设置自定义存储目录（传 null 恢复默认）和导入策略 */
  setStorageDir: (dir: string | null, importStrategy?: ImportStrategy, civitaiBaseUrl?: CivitaiBaseUrl, aiTagBaseUrl?: string, aiTagModel?: string) =>
    invoke<StorageConfig>('set_storage_dir', { dir, importStrategy: importStrategy || null, civitaiBaseUrl: civitaiBaseUrl || null, aiTagBaseUrl: aiTagBaseUrl || null, aiTagModel: aiTagModel || null }),

  /** 获取图片的 Base64 编码数据，用于前端显示；同一图片请求会复用缓存/进行中的 Promise */
  getImageBase64: (imageId: number, useThumbnail = true) =>
    getCachedImageBase64(imageId, useThumbnail),

  /** 鼠标悬浮缩略图时预取原图，降低打开详情页时的等待感 */
  prefetchFullImage: (imageId: number) => {
    void getCachedImageBase64(imageId, false).catch(() => {});
  },

  /** 查询系统凭据库里是否保存了 Civitai API Key */
  getCivitaiKeyStatus: () =>
    invoke<CivitaiKeyStatus>('get_civitai_key_status'),

  /** 保存 Civitai API Key 到系统凭据库，传空字符串可清除 */
  setCivitaiApiKey: (apiKey: string) =>
    invoke<CivitaiKeyStatus>('set_civitai_api_key', { apiKey }),

  /** 通过模型文件 hash 查询 Civitai 模型版本信息 */
  lookupCivitaiByHash: (hash: string) =>
    invoke<CivitaiLookupResult | null>('lookup_civitai_by_hash', { hash }),

  /** 使用系统默认浏览器打开受信任链接 */
  openUrl: (url: string) =>
    invoke<void>('open_url', { url }),

  /** 查询/保存 AI 打标 API Key 与配置 */
  getAiTagKeyStatus: () =>
    invoke<AiTagKeyStatus>('get_ai_tag_key_status'),
  setAiTagApiKey: (apiKey: string) =>
    invoke<AiTagKeyStatus>('set_ai_tag_api_key', { apiKey }),
  getAiTagConfig: () =>
    invoke<AiTagConfig>('get_ai_tag_config'),
  setAiTagConfig: (baseUrl: string, model: string) =>
    invoke<AiTagConfig>('set_ai_tag_config', { baseUrl, model }),
  startAiTaggingMissingImages: () =>
    invoke<void>('start_ai_tagging_missing_images'),

  /** 导出图库数据到 zip 文件，返回结果描述 */
  exportGallery: (destPath: string) =>
    invoke<string>('export_gallery', { destPath }),

  /** 异步启动图库导出任务，进度通过 export-progress / export-finished 事件推送 */
  startExportGallery: (destPath: string) =>
    invoke<void>('start_export_gallery', { destPath }),

  /** 从 zip 文件导入图库数据，返回结果描述 */
  importGallery: (zipPath: string) =>
    invoke<string>('import_gallery', { zipPath }),

  /** 异步启动图库导入任务，进度通过 backup-import-progress / backup-import-finished 事件推送 */
  startImportGallery: (zipPath: string) =>
    invoke<void>('start_import_gallery', { zipPath }),
};
