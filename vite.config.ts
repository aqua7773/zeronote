import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// ZeroNote —— Tauri 2 前端配置
// dev server 默认 1420（tauri.conf.json 的 devUrl 依赖它），src-tauri 变化不触发前端 HMR。
//
// 桌面与安卓 dev 同时跑时会抢同一个端口，所以端口可用 ZN_PORT 覆盖
// （android-dev.cmd 里设成 1421），并且关掉 strictPort —— 端口被占时自动往后找，
// 而不是像以前那样直接启动失败。
const port = Number(process.env.ZN_PORT ?? 1420)

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // 与 tsconfig.app.json 的 paths 对齐：抄 Lumina/shadcn 组件时 import 不用改
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  clearScreen: false,
  server: {
    port,
    strictPort: false,
    // Android 真机要通过局域网 IP 访问 dev server（tauri android dev 会选定本机 IP）
    host: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: {
    target: 'esnext',
    sourcemap: true,
  },
})
