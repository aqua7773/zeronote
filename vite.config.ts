import { networkInterfaces } from 'node:os'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * 应用版本号的**单一来源** = `package.json` 的 `version`（rev173.37）。
 * 发版用 `node scripts/release.mjs <x.y.z>` 同步三处（package.json / tauri.conf.json / Cargo.toml）；
 * 前端经 `__APP_VERSION__` 注入（关于页显示它，不再硬编码）。
 */
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
  version: string
}

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
  // 应用版本号注入（关于页 / 将来更新检查用；值来自 package.json）
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
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
    // 真机 HMR 必须**显式指定 host 和 port**：安卓 WebView 里页面的 location.hostname 是
    // `tauri.localhost`（Tauri 的 origin）且**没有端口**，vite 客户端据此拼出的 ws 地址是
    // `ws://<ip>:/`（端口为空）——真机日志里表现为 `[vite] failed to connect to websocket`。
    // 这里把两者都钉死：host 走局域网 IPv4、port 走 dev server 端口。
    hmr: hmrHost ? { host: hmrHost, port } : undefined,
    watch: {
      /**
       * 不让「运行时会被写」的目录触发前端 HMR（rev137 实测根因）：
       * 内置插件由 `ensureBuiltinPlugins` 写进 `<库>/.zn/plugins/`，验收夹具库 `_tmp-*` 也在
       * 项目树内 —— 这些写入会被 watcher 当成源码变化 ⇒ HMR ⇒ React Refresh 重放 effect
       * ⇒ 插件加载链重跑 ⇒ 又写一遍，形成「写 → HMR → 重载 → 再写」的无限循环
       * （实测周期 ≈6 秒；用户看到的就是「插件主题样式消失几百毫秒 = 闪一下深色」）。
       *
       * rev173.338：再加**编辑器/工具保存时的临时文件** —— 有的工具走「写 `.xxx.tmpdir/<名>.tmp`
       * 再 rename」的原子保存，vite 默认会去 watch 这些目录，Windows 下它们被锁着 ⇒
       * `EBUSY: resource busy or locked` ⇒ **watcher 直接崩、dev server 整个退出**（2026-11-02
       * 一天内撞了两次）。这些临时文件永远不会是源码。
       */
      ignored: [
        '**/src-tauri/**',
        '**/_tmp-*/**',
        '**/.zn/**',
        '**/_shots/**',
        '**/_build/**',
        '**/.*.tmpdir/**',
        '**/*.tmp',
      ],
    },
  },
  build: {
    target: 'esnext',
    sourcemap: true,
  },
})
