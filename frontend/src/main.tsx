// 应用入口文件
// 渲染根组件 App，包裹 I18nProvider 提供国际化上下文
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider } from './i18n'
import './index.css'
import App from './App'

// 挂载 React 应用到 DOM，StrictMode 启用额外的开发期检查
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
)
