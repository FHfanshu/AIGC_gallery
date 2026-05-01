// 英文翻译文件
// 定义所有 UI 文本的英文版本，同时作为 Translations 类型的基准

export const en = {
  app: {
    title: 'AIGC Gallery',
  },
  nav: {
    gallery: 'Gallery',
    favorites: 'Favorites',
    settings: 'Settings',
  },
  import: {
    importPngs: 'Import PNGs',
    importFolder: 'Import Folder',
    importing: 'Importing...',
    success: 'Imported',
    skipped: 'Skipped',
    errors: 'Errors',
    dropHere: 'Drop PNG files here',
    dropHint: 'Images will be imported with metadata auto-detected',
  },
  gallery: {
    emptyTitle: 'No images yet',
    emptyHint: 'Click "Import PNGs" or drag and drop PNG files anywhere onto this window',
    images: 'images',
    tags: 'tags',
  },
  header: {
    searchPlaceholder: 'Search prompts, filenames...',
    filtering: 'Filtering',
    count: '{count} images',
    hideNSFW: 'Hide NSFW',
  },
  detail: {
    imageDetail: 'Image Detail',
    prompt: 'Prompt',
    negativePrompt: 'Negative Prompt',
    negPlaceholder: 'Negative prompt...',
    characters: 'Characters',
    parameters: 'Parameters',
    steps: 'Steps',
    cfg: 'CFG',
    seed: 'Seed',
    sampler: 'Sampler',
    size: 'Size',
    source: 'Source',
    model: 'Model',
    file: 'File',
    delete: 'Delete',
    save: 'Save',
    cancel: 'Cancel',
    edit: 'Edit',
    copy: 'Copy',
    copied: 'Copied!',
  },
  sidebar: {
    tags: 'Tags',
    tagPlaceholder: 'Tag name...',
    add: 'Add',
    all: 'All',
    models: 'Models',
    storagePath: 'Storage Path',
    customDir: 'Custom Directory',
    customDirPlaceholder: 'Leave empty for default',
    saveStorage: 'Save',
  },
} as const;

/** 翻译类型 — 从 en 对象自动推断，确保所有语言文件结构一致 */
export type Translations = typeof en;
