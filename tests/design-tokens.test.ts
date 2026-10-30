/**
 * 设计 token 回归（UI 重布局 B7 · 方案 §6「视觉与动效统一」）。
 *
 * 锁三件事，任何一条挂了都说明「token 化被手写数值冲回去了」：
 *   1. 动效 token 在 `:root` 里齐全（五档时长 + 标题栏专用 + 四条缓动）；
 *   2. `transition` / `animation` 声明里不再有裸时长（拖拽跟手 40ms 是唯一例外）；
 *   3. `prefers-reduced-motion` 是**全局**降级，不是只写 `.zn-titlebar` 一条。
 *
 * 这是静态检查，不跑浏览器 —— 真机 / CDP 的视觉验收在批次收尾截图里做。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const css = readFileSync(join(root, 'src/styles.css'), 'utf8')
const editor = readFileSync(join(root, 'src/components/MarkdownEditor.tsx'), 'utf8')
const titleBar = readFileSync(join(root, 'src/components/TitleBar.tsx'), 'utf8')

/** 五档 + 标题栏专用档（调研 §2 / §6） */
const DURATIONS = ['hover', 'fast', 'base', 'panel', 'drill', 'titlebar']
/** 四条缓动（M3 / Fluent 收敛值） */
const EASES = ['standard', 'decel', 'accel', 'emph']

/** 拖拽跟手是唯一允许的裸时长：transition 会把落点提示框「滑」过去，不算 UI 动效档位 */
const DRAG_FOLLOW = '40ms'

function transitionBlocks(source: string): string[] {
  const noComments = source.replace(/\/\*[\s\S]*?\*\//g, '')
  return [...noComments.matchAll(/\b(?:transition|animation)\s*:([^;{}]*)/g)].map((m) => m[1].trim())
}

describe('设计 token：动效（B7）', () => {
  it('五档时长 + 标题栏专用档都声明在 :root', () => {
    for (const name of DURATIONS) {
      expect(css, `--zn-dur-${name}`).toContain(`--zn-dur-${name}:`)
    }
  })

  it('标题栏 200ms（验收硬指标 ≤200ms）', () => {
    expect(css).toMatch(/--zn-dur-titlebar:\s*(\d+)ms/)
    const ms = Number(/--zn-dur-titlebar:\s*(\d+)ms/.exec(css)?.[1])
    expect(ms).toBeLessThanOrEqual(200)
  })

  it('四条缓动都声明在 :root', () => {
    for (const name of EASES) {
      expect(css, `--zn-ease-${name}`).toContain(`--zn-ease-${name}:`)
    }
  })

  it('reduce-motion 是全局降级（所有元素 + animation/transition 都压到 1ms）', () => {
    const block = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
    expect(block).toContain('*::before')
    expect(block).toContain('*::after')
    expect(block).toMatch(/animation-duration:\s*1ms\s*!important/)
    expect(block).toMatch(/transition-duration:\s*1ms\s*!important/)
  })

  it('styles.css 的 transition / animation 里没有裸时长（拖拽跟手除外）', () => {
    const blocks = transitionBlocks(css)
    expect(blocks.length).toBeGreaterThan(20)
    const offenders = blocks.filter((v) => {
      const withoutDrag = v.replaceAll(DRAG_FOLLOW, '')
      return /\d+(?:\.\d+)?m?s\b/.test(withoutDrag)
    })
    expect(offenders).toEqual([])
  })

  it('编辑器模板字符串里的 animation 也走 token', () => {
    expect(editor).not.toMatch(/animation:\s*zn-wiki-in\s+\d/)
    expect(editor).toContain('var(--zn-dur-fast)')
  })

  it('TitleBar 不再手写 450ms，改读 token', () => {
    expect(titleBar).not.toContain('450ms')
    expect(titleBar).toContain('var(--zn-dur-titlebar)')
  })

  /** B7 视觉统一：图标只剩两档 —— 16（行内 / 工具条）/ 20（图标栏 / 底部导航 / 列表行） */
  it('组件里的图标尺寸只有 16 / 20 两档', () => {
    const componentsDir = join(root, 'src/components')
    const files = readdirSync(componentsDir).filter((f) => f.endsWith('.tsx'))
    const sizes = new Set<number>()
    const offenders: string[] = []
    for (const f of files) {
      const src = readFileSync(join(componentsDir, f), 'utf8')
      for (const m of src.matchAll(/\bsize=\{(\d+)\}/g)) {
        const n = Number(m[1])
        sizes.add(n)
        if (n !== 16 && n !== 20) offenders.push(`${f}: size={${n}}`)
      }
    }
    expect([...sizes].sort((a, b) => a - b)).toEqual([16, 20])
    expect(offenders).toEqual([])
  })
})
