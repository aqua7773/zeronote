import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

/**
 * 注意：**没有 StrictMode**。
 * 插件加载是"异步 + 副作用密集"的（动态 import、注册命令与面板），
 * StrictMode 的双调用会与异步清理竞争，导致面板重复注册 / 插件重复激活。
 * 插件宿主的幂等性由内核自己保证（`registerPanel` 同 id 替换、命令 id 重复抛错）。
 */
createRoot(document.getElementById('root')!).render(<App />)
