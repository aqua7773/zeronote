import { networkInterfaces } from 'node:os'
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * 找一个**真机可达**的局域网 IPv4，供 HMR 用。
 *
 * 必须排除 Hyper-V / WSL / VirtualBox 等虚拟网卡 —— 本机实测同时存在：
 *   192.168.1.20（WLAN，手机可达） · 172.31.32.1（vEthernet (MyApps)，手机不可达）
 * 取到虚拟网卡会让真机更连不上，比不设还糟。
 */
function lanIp(): string | undefined {
  const VIRTUAL = /vEthernet|Hyper-V|VirtualBox|VMware|Loopback|WSL|Tailscale|ZeroTier/i
  const found: string[] = []
  for (const [name, list] of Object.entries(networkInterfaces())) {
    if (VIRTUAL.test(name)) continue
    for (const ni of list ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) found.push(ni.address)
    }
  }
  return found.find((a) => a.startsWith('192.168.')) ?? found[0]
}

// ZeroNote —— Tauri 2 前端配置
// dev server 默认 1420（tauri.conf.json 的 devUrl 依赖它），src-tauri 变化不触发前端 HMR。
//
// 桌面与安卓 dev 同时跑时会抢同一个端口，所以端口可用 ZN_PORT 覆盖
// （android-dev.cmd 里设成 1421），并且关掉 strictPort —— 端口被占时自动往后找，
// 而不是像以前那样直接启动失败。
const port = Number(process.env.ZN_PORT ?? 1420)
const hmrHost = process.env.ZN_HMR_HOST ?? lanIp()

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
    // 真机 HMR 必须**显式指定 host**：安卓 WebView 里页面的 location.hostname 是
    // `tauri.localhost`（Tauri 的 origin），vite 客户端据此推出的地址手机连不到，
    // 真机日志里表现为 `[vite] failed to connect to websocket`。
    // hmr.host 是服务端注入给**所有**客户端的，桌面端会连同一个局域网 IP
    // （本机访问自己的局域网地址没问题）。需要覆盖时设 ZN_HMR_HOST。
    hmr: hmrHost ? { host: hmrHost } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: {
    target: 'esnext',
    sourcemap: true,
  },
})
