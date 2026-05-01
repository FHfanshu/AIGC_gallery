// 中文翻译文件
// 与 en.ts 结构完全一致，类型由 en.ts 的 Translations 约束
import type { Translations } from './en';

export const zh: Translations = {
  app: {
    title: 'AIGC 画廊',
  },
  nav: {
    gallery: '画廊',
    favorites: '收藏',
    settings: '设置',
  },
  import: {
    importPngs: '导入 PNG',
    importFolder: '导入文件夹',
    importing: '导入中...',
    success: '已导入',
    skipped: '已跳过',
    errors: '错误',
    dropHere: '拖放 PNG 文件到此处',
    dropHint: '图片将自动识别元数据并导入',
  },
  gallery: {
    emptyTitle: '暂无图片',
    emptyHint: '点击「导入 PNG」或将 PNG 文件拖放到窗口中',
    images: '张图片',
    tags: '个标签',
  },
  header: {
    searchPlaceholder: '搜索 prompt、文件名...',
    filtering: '筛选',
    count: '{count} 张图片',
    hideNSFW: '隐藏NSFW',
  },
  detail: {
    imageDetail: '图片详情',
    prompt: '提示词',
    negativePrompt: '反向提示词',
    negPlaceholder: '反向提示词...',
    characters: '角色',
    parameters: '参数',
    steps: '步数',
    cfg: 'CFG',
    seed: '种子',
    sampler: '采样器',
    size: '尺寸',
    source: '来源',
    model: '模型',
    file: '文件',
    delete: '删除',
    save: '保存',
    cancel: '取消',
    edit: '编辑',
    copy: '复制',
    copied: '已复制!',
  },
  sidebar: {
    tags: '标签',
    tagPlaceholder: '标签名称...',
    add: '添加',
    all: '全部',
    models: '模型',
    storagePath: '存储路径',
    customDir: '自定义目录',
    customDirPlaceholder: '留空使用默认路径',
    saveStorage: '保存',
  },
};
