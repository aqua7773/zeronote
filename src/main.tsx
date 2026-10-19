import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { applyBootPluginStyles } from './lib/boot-plugin-styles'
import { GlobalScrollbars } from './components/GlobalScrollbars'

/**
 * 注意：**没有 StrictMode**。
 * 插件加载是"异步 + 副作用密集"的（动态 import、注册命令与面板），
 * StrictMode 的双调用会与异步清理竞争，导致面板重复注册 / 插件重复激活。
 * 插件宿主的幂等性由内核自己保证（`registerPanel` 同 id 替换、命令 id 重复抛错）。
 */

// 首屏预热插件样式（主题类插件）—— 必须在 React 挂载前、且在内核 styles.css 之后，
// 否则主题插件要等异步加载完才生效，等于每次启动都闪一下内核深色（rev135）。
applyBootPluginStyles()

createRoot(document.getElementById('root')!).render(
  <>
    <App />
    {/* 全局自绘滚动条（rev173.34）：所有滚动容器统一、隐藏轨道、沉浸式滑块。
        挂在 App 外，整窗接管（插件 shell）时也生效。 */}
    <GlobalScrollbars />
  </>,
)
