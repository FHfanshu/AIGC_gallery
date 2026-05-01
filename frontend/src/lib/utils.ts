// 工具函数库 — 提供前端通用的辅助函数
// 包括样式类名拼接、图片路径转换、元数据解析、文本截断等

import { convertFileSrc } from '@tauri-apps/api/core';

/**
 * cn — 条件式 CSS 类名拼接工具
 * 过滤掉 falsy 值（false、undefined、null、空字符串），将剩余类名用空格连接
 * @param classes - 类名列表，支持条件表达式
 * @returns 拼接后的类名字符串
 */
export function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

/**
 * getImageSrc — 将本地文件路径转换为 Tauri 可加载的资源 URL
 * Tauri 前端无法直接使用本地路径加载图片，需通过 convertFileSrc 转换
 * @param path - 本地文件路径
 * @returns 可用于 <img src> 的 URL 字符串，无效路径返回空字符串
 */
export function getImageSrc(path: string | null | undefined): string {
  if (!path) return '';
  try {
    return convertFileSrc(path);
  } catch {
    return '';  // 转换失败时返回空字符串，避免页面报错
  }
}

/**
 * parseMetadata — 解析图片元数据 JSON 字符串
 * @param json - 元数据的 JSON 字符串
 * @returns 解析后的对象，解析失败返回 null
 */
export function parseMetadata(json: string) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * truncate — 文本截断工具
 * 超过指定长度时截断并添加省略号
 * @param str - 原始字符串
 * @len - 最大保留长度
 * @returns 截断后的字符串
 */
export function truncate(str: string, len: number): string {
  return str.length > len ? str.slice(0, len) + '...' : str;
}

/**
 * getSourceLabel — 根据图片来源类型返回显示标签和对应颜色
 * 用于在图库中用不同颜色标识不同 AI 生成工具的来源
 * @param source - 来源标识（如 "a1111"、"comfyui"、"novelai"）
 * @returns 包含 label（显示名称）和 color（十六进制色值）的对象
 */
export function getSourceLabel(source: string): { label: string; color: string } {
  const map: Record<string, { label: string; color: string }> = {
    a1111: { label: 'A1111', color: '#22c55e' },     // 绿色 — Stable Diffusion WebUI
    comfyui: { label: 'ComfyUI', color: '#3b82f6' }, // 蓝色 — ComfyUI 节点式工具
    novelai: { label: 'NovelAI', color: '#f472b6' }, // 粉色 — NovelAI
    unknown: { label: 'Unknown', color: '#6b7280' }, // 灰色 — 未知来源
  };
  return map[source] || map.unknown;  // 未匹配时默认返回 Unknown
}

/**
 * debounce — 通用防抖函数
 * 在指定时间内多次调用只执行最后一次，常用于搜索输入等场景
 * @param fn - 需要防抖的目标函数
 * @param ms - 延迟毫秒数
 * @returns 包装后的防抖函数
 */
export function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout>;
  return ((...args: any[]) => {
    clearTimeout(timer);                    // 每次调用时清除上次定时器
    timer = setTimeout(() => fn(...args), ms);  // 重新设定延迟执行
  }) as T;
}
