// @vitest-environment happy-dom
/**
 * 启动兜底（rev173.349 · `index.html` 内联脚本）的行为测试。
 *
 * 背景：2026-11-04 真机白屏类型 A —— `@vite/client` 500、模块图没执行，
 * `#root` 空且页面没有任何提示。那一套兜底必须写在 HTML 里（React 内的三套都跑不到），
 * 所以它没有 TS 模块可 import —— 这里直接从 `index.html` 抽出脚本执行，
 * 用假定时器把 25 秒的判据压缩成毫秒级。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * happy-dom 环境下 `import.meta.url` 不是 file: 协议（`fileURLToPath` 会抛
 * "The URL must be of scheme file"），所以用 vitest 的工作目录（= 项目根）拼绝对路径。
 */
const INDEX_PATH = resolve(process.cwd(), 'index.html')
const MAIN_PATH = resolve(process.cwd(), 'src/main.tsx')

/** 从 index.html 里抽出启动兜底那段内联脚本（按 `__znBootGuard` 认，主题那段不算） */
function extractBootGuard(): string {
  const html = readFileSync(INDEX_PATH, 'utf-8')
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])
  const found = blocks.find((b) => b.includes('__znBootGuard'))
  if (!found) throw new Error('index.html 里找不到启动兜底脚本（找 __znBootGuard 标记）')
  return found
}

/** 模拟一次页面启动：清空 DOM、清掉标记、执行脚本 */
function bootOnce(opts: { keepRetryFlag?: boolean } = {}): void {
  document.body.innerHTML = '<div id="root"></div>'
  delete window.__znBooted
  delete window.__znBootGuard
  // 真实 reload 会保留 sessionStorage —— 模拟「重试后的第二次启动」时不要清
  if (!opts.keepRetryFlag) sessionStorage.clear()
  new Function(extractBootGuard())()
}

describe('启动兜底（index.html 内联脚本）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('正常挂载后不再检查、不留重试标记', () => {
    bootOnce()
    window.__znBooted = true
    vi.advanceTimersByTime(1000)

    expect(window.__znBootGuard?.settled()).toBe(true)
    expect(document.getElementById('zn-boot-fail')).toBeNull()
    expect(sessionStorage.getItem('zn.boot-rescue-done')).toBeNull()
  })

  it('#root 里有内容也算成功（React 挂载完成但标记没及时置上）', () => {
    bootOnce()
    const root = document.getElementById('root')
    root?.appendChild(document.createElement('div'))
    vi.advanceTimersByTime(1000)

    expect(window.__znBootGuard?.settled()).toBe(true)
    expect(document.getElementById('zn-boot-fail')).toBeNull()
  })

  it('超时且没重试过 ⇒ 自动重载一次', () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    bootOnce()

    vi.advanceTimersByTime(26_000)

    expect(reload).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem('zn.boot-rescue-done')).toBe('1')
  })

  it('重试后仍然失败 ⇒ 显示错误卡片，不再无限重载', () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    bootOnce()

    // 第一次：自动重载
    vi.advanceTimersByTime(26_000)
    expect(reload).toHaveBeenCalledTimes(1)

    // 相当于 reload 后第二次启动（sessionStorage 里的重试标记还在）
    bootOnce({ keepRetryFlag: true })
    vi.advanceTimersByTime(26_000)

    expect(reload).toHaveBeenCalledTimes(1) // 没有第二次 reload
    const card = document.getElementById('zn-boot-fail')
    expect(card).not.toBeNull()
    expect(card?.textContent).toContain('页面没能加载起来')
    expect(card?.textContent).toContain('重新加载')
  })

  it('script / link 加载失败 ⇒ 立即触发，不等 25 秒', () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    bootOnce()

    // 不设 src：happy-dom 会尝试真的去加载带 src 的 script 并抛 DOMException，
    // 这里只要一个在文档里、tagName 为 SCRIPT 的节点来派发 error 事件
    const script = document.createElement('script')
    document.body.appendChild(script)
    script.dispatchEvent(new Event('error'))

    expect(reload).toHaveBeenCalledTimes(1)
  })
})

describe('main.tsx ↔ index.html 契约', () => {
  it('main.tsx 挂载后必须置 window.__znBooted', () => {
    const src = readFileSync(MAIN_PATH, 'utf-8')
    expect(src).toContain('window.__znBooted = true')
  })

  it('index.html 的判据必须读 __znBooted（防止有人改成别的名字后两边漂开）', () => {
    expect(extractBootGuard()).toContain('__znBooted')
  })
})
