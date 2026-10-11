import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// ZeroNote —— Tauri 2 前端配置
// dev server 固定 1420（tauri.conf.json 的 devUrl 依赖它），src-tauri 变化不触发前端 HMR
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: {
    target: 'esnext',
    sourcemap: true,
  },
})
