// 国际化（i18n）模块入口
// 提供 React Context 实现的语言切换功能，支持中英文
import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { en, type Translations } from './locales/en';
import { zh } from './locales/zh';

/** 支持的语言类型 */
export type Locale = 'en' | 'zh';

/** 语言映射表：locale 代码 → 翻译对象 */
const locales: Record<Locale, Translations> = { en, zh };

/** I18n Context 的值类型 */
interface I18nContextValue {
  locale: Locale;                                    // 当前语言
  t: Translations;                                   // 当前翻译对象
  setLocale: (locale: Locale) => void;               // 切换语言
  toggleLocale: () => void;                          // 中英文快速切换
}

const I18nContext = createContext<I18nContextValue | null>(null);

/**
 * 从 localStorage 和浏览器语言推断初始语言
 * 优先读取 localStorage 缓存，否则根据 navigator.language 判断
 */
function getInitialLocale(): Locale {
  const saved = localStorage.getItem('locale') as Locale | null;
  if (saved && (saved === 'en' || saved === 'zh')) return saved;
  const lang = navigator.language.toLowerCase();
  return lang.startsWith('zh') ? 'zh' : 'en';
}

/**
 * I18n Provider 组件
 * 包裹应用根组件，通过 Context 向子组件注入翻译能力和语言切换方法
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getInitialLocale);

  // 切换语言并持久化到 localStorage
  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    localStorage.setItem('locale', l);
  }, []);

  // 快速切换中英文
  const toggleLocale = useCallback(() => {
    setLocale(locale === 'en' ? 'zh' : 'en');
  }, [locale, setLocale]);

  const value: I18nContextValue = {
    locale,
    t: locales[locale],
    setLocale,
    toggleLocale,
  };

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * 获取 i18n 上下文的 Hook
 * 必须在 I18nProvider 内部使用
 */
export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}

/**
 * 模板字符串变量替换工具
 * 将 "{key}" 占位符替换为 vars 中对应的值
 * @param template - 含占位符的模板字符串
 * @param vars - 键值对映射
 * @returns 替换后的字符串
 */
export function tReplace(template: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce(
    (s, [k, v]) => s.replace(`{${k}}`, String(v)),
    template
  );
}
