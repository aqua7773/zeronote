import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * 前端单测（vitest）—— 只测**纯逻辑**：kernel/lib 里不碰 DOM、不碰 Tauri invoke 的模块。
 *
 * 为什么不复用 `vite.config.ts`：那个文件会读网卡枚举（lanIp）、挂 react/tailwind 插件、
 * 起 dev server 配置 —— 单测一样用不上，还会把「本机有没有局域网」变成测试的前置条件。
 * 这里只留最小配置 + 与 tsconfig.app.json 一致的 `@` 别名。
 *
 * 测试文件放 `tests/`（不在 tsconfig.app.json 的 include 里）：
 * 这样 `tsc -b` 的基线仍是「只检查 src」，测试代码的类型由 vitest 自己转译，
 * 不会因为一条断言写法让 verify.ps1 第 1 步变红。
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
