import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { applyBootPluginStyles } from './lib/boot-plugin-styles'
import { GlobalScrollbars } from './components/GlobalScrollbars'
import { bootMark, logBootMarks } from './lib/boot-marks'

/**
 * 启动耗时打点（rev173.351 · 真人测试11 #2）—— 先量再改，不猜。
 * 表用 CDP 读：`__znBootMarks()`；日志里是 `[zn-boot] entry@… styles-ready@…`。
 */
bootMark('entry')

/**
 * 注意：**没有 StrictMode**。
 * 插件加载是"异步 + 副作用密集"的（动态 import、注册命令与面板），
 * StrictMode 的双调用会与异步清理竞争，导致面板重复注册 / 插件重复激活。
 * 插件宿主的幂等性由内核自己保证（`registerPanel` 同 id 替换、命令 id 重复抛错）。
 */

// 首屏预热插件样式（主题类插件）—— 必须在 React 挂载前、且在内核 styles.css 之后，
// 否则主题插件要等异步加载完才生效，等于每次启动都闪一下内核深色（rev135）。
applyBootPluginStyles()
bootMark('styles-ready')

createRoot(document.getElementById('root')!).render(
  <>
    <App />
    {/* 全局自绘滚动条（rev173.34）：所有滚动容器统一、隐藏轨道、沉浸式滑块。
        挂在 App 外，整窗接管（插件 shell）时也生效。 */}
    <GlobalScrollbars />
  </>,
)

/**
 * 启动兜底标记（rev173.349）：`index.html` 的内联脚本看到这个标记就不再等待。
 * 白屏类型 A（模块加载失败 / `@vite/client` 500）时这一行永远执行不到 ——
 * 内联脚本会在 25 秒后自动重载一次，再失败就显示错误卡片（见 index.html 那段注释）。
 */
window.__znBooted = true
bootMark('render-called')

// 首帧（第一次 rAF）：这里的耗时 = React 首屏渲染 + 样式计算 + 绘制排队
requestAnimationFrame(() => {
  bootMark('first-frame')
  logBootMarks()
})
